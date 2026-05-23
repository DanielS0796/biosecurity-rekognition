const Sentry = require("@sentry/aws-serverless");

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    initialScope: {
        tags: {
            module: process.env.MODULE_NAME || "unknown",
            team: process.env.TEAM_GROUP || "anlusoft"
        }
    }
});

module.exports = Sentry;
