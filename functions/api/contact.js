/* Cloudflare Pages Function — POST /api/contact
   환경변수(Cloudflare Pages dashboard > Settings > Environment variables):
     NAVER_SMTP_PASS  : 네이버 SMTP 비밀번호
     ALLOWED_ORIGIN   : 배포 후 도메인 (예: https://mapo-frontier.pages.dev)
*/

const rateMap = {};
function isRateLimited(ip) {
    const now = Date.now();
    if (!rateMap[ip]) rateMap[ip] = [];
    rateMap[ip] = rateMap[ip].filter(t => now - t < 60000);
    if (rateMap[ip].length >= 3) return true;
    rateMap[ip].push(now);
    return false;
}

async function sendMailViaSmtp(env, mailOptions) {
    /* Cloudflare Workers/Pages 환경에서는 nodemailer 대신
       fetch를 이용해 네이버 SMTP 릴레이를 호출합니다.
       여기서는 MailChannels(무료) 또는 직접 SMTP over fetch 방식을 사용합니다.
       실제 배포 시 아래 두 가지 방법 중 선택:
         1) MailChannels Send API (Cloudflare 파트너, 무료)
         2) 직접 SMTP: Cloudflare Workers는 TCP 소켓(connect)을 지원하지 않으므로
            대신 naver SMTP를 호출하는 별도 Worker 또는 SMTP-over-HTTPS 서비스 필요
       아래는 MailChannels v1 API 사용 예시 */
    const payload = {
        personalizations: [{
            to: [{ email: 'niceofhi@naver.com', name: '마포프론티어 관심등록' }]
        }],
        from: { email: 'niceofhi@naver.com', name: '이대역 마포 프론티어' },
        subject: mailOptions.subject,
        content: [{ type: 'text/plain', value: mailOptions.text }]
    };

    const resp = await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!resp.ok && resp.status !== 202) {
        const err = await resp.text();
        throw new Error(`MailChannels error ${resp.status}: ${err}`);
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;

    const allowedOrigins = [
        env.ALLOWED_ORIGIN,
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:3000'
    ].filter(Boolean);

    const origin = request.headers.get('origin') || '';
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] || '*'),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    const ip = request.headers.get('cf-connecting-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (isRateLimited(ip)) {
        return new Response(JSON.stringify({ success: false, error: '잠시 후 다시 시도해주세요.' }),
            { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    let body;
    try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    const { from_name, phone, reply_to, unit_type, region, visit_date, visit_time, message } = body || {};

    if (!from_name || !phone) {
        return new Response(JSON.stringify({ success: false, error: '필수 항목이 누락되었습니다.' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    const lines = [];
    lines.push(`이름: ${from_name}`);
    lines.push(`연락처: ${phone}`);
    if (reply_to && reply_to !== '미입력')    lines.push(`이메일: ${reply_to}`);
    if (unit_type && unit_type !== '미선택')  lines.push(`관심 타입: ${unit_type}`);
    if (region && region !== '미선택')         lines.push(`거주지역: ${region}`);
    if (visit_date)                            lines.push(`희망 방문일: ${visit_date}`);
    if (visit_time && visit_time !== '미선택') lines.push(`희망 시간대: ${visit_time}`);
    if (message && message !== '없음')         lines.push(`\n문의사항:\n${message}`);

    try {
        await sendMailViaSmtp(env, {
            subject: `[이대역 마포 프론티어] 관심등록 - ${from_name}`,
            text: lines.join('\n')
        });
        return new Response(JSON.stringify({ success: true }),
            { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    } catch (error) {
        console.error('Mail send error:', error);
        return new Response(JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
}

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}
