export const MARKETING_CONFIG = {
    // 塾導線を復元する場合は、下の3つを true に戻す。
    enableRecruitmentBanner: false,
    enableAdBanners: true,
    enableConsultation: false,
    enableSchoolContactLinks: false,
    // 課金導線を復元する場合は true に戻す。
    enablePremiumBilling: false,
    launchPremiumAccess: {
        enabled: true,
        endsAt: '2026-09-20T14:59:59.999Z',
        label: 'ローンチ無料開放'
    },
    brandName: 'Success Edge',
    lineUrl: 'https://lin.ee/xHv8XDs',
    promoCode: 'SUMASAI2026',
    promoGating: {
        enabled: true,
        triggerCount: 1, // 1回以上採点済み（＝2回目以降）で要求
        label: '公式LINE無料開放コード'
    },
    consultationUrl: 'https://www.success-edge.net/contact/',
    consultationPath: '/consultation',
    aboutUrl: 'https://www.success-edge.net/about/',
    paypayPass: { label: '1か月プラン', amountLabel: '2,980円', durationLabel: '1か月' },
};
