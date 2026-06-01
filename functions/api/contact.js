/* Cloudflare Pages Function — POST /api/contact
   Cloudflare Pages > Settings > Environment variables 에 아래 두 값을 등록하세요:
     RESEND_API_KEY  : resend.com에서 발급한 API Key (예: re_xxxxxxxxxx)
     RESEND_TO       : 관심등록 알림 받을 이메일 (예: niceofhi@naver.com)
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

export async function onRequestPost(context) {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // Rate limit
    const ip = request.headers.get('cf-connecting-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (isRateLimited(ip)) {
        return new Response(JSON.stringify({ success: false, error: '잠시 후 다시 시도해주세요.' }),
            { status: 429, headers: corsHeaders });
    }

    // Body 파싱
    let body;
    try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid request' }),
            { status: 400, headers: corsHeaders });
    }

    const { from_name, phone, unit_type, region, message } = body || {};

    if (!from_name || !phone) {
        return new Response(JSON.stringify({ success: false, error: '성함과 연락처는 필수입니다.' }),
            { status: 400, headers: corsHeaders });
    }

    // 이메일 본문 구성
    const lines = [
        `이름: ${from_name}`,
        `연락처: ${phone}`,
    ];
    if (unit_type && unit_type !== '미선택') lines.push(`관심 타입: ${unit_type}`);
    if (region   && region   !== '미선택') lines.push(`거주지역: ${region}`);
    if (message  && message  !== '없음')   lines.push(`\n문의사항:\n${message}`);

    // Resend API 호출
    const toEmail = env.RESEND_TO || 'niceofhi@naver.com';
    const apiKey  = env.RESEND_API_KEY;

    if (!apiKey) {
        console.error('RESEND_API_KEY 환경변수가 설정되지 않았습니다.');
        return new Response(JSON.stringify({ success: false, error: '서버 설정 오류' }),
            { status: 500, headers: corsHeaders });
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'onboarding@resend.dev',         // 무료 플랜 기본 발신자
                to:   [toEmail],
                subject: `[이대역 마포 프론티어] 관심등록 — ${from_name}`,
                text: lines.join('\n')
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Resend ${res.status}: ${err}`);
        }

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });

    } catch (err) {
        console.error('Email send error:', err);
        return new Response(JSON.stringify({ success: false, error: err.message }),
            { status: 500, headers: corsHeaders });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}
