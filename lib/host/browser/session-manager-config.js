export const PLATFORM_AUTH_CONFIG = {
    xiaohongshu: {
        initialUrl: "https://www.xiaohongshu.com/explore",
        domains: ["xiaohongshu.com"],
        requiredCookies: ["a1", "web_session"],
        verifyPredicate: (names) => names.has("a1") && names.has("web_session"),
    },
    x: {
        initialUrl: "https://x.com/home",
        domains: ["x.com", "twitter.com"],
        requiredCookies: ["auth_token", "ct0"],
        verifyPredicate: (names) => names.has("auth_token") && names.has("ct0"),
    },
};
