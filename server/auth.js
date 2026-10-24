import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { Resend } from 'resend';

export function createAuth(db, config, { deliverOTP } = {}) {
  const resend = new Resend(config.resendKey);
  return betterAuth({
    appName: 'Wilderness Almanac',
    baseURL: config.appOrigin,
    basePath: '/api/auth',
    secret: config.secret,
    database: db,
    trustedOrigins: [config.appOrigin],
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['x-wilderness-almanac-client-ip'] },
      useSecureCookies: config.production,
      defaultCookieAttributes: { httpOnly: true, secure: config.production, sameSite: 'lax' },
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        rateLimit: { window: 60, max: 3 },
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') throw new Error('Only email sign-in is supported.');
          if (deliverOTP) return deliverOTP({ email, otp });
          const { error } = await resend.emails.send({
            from: config.resendFrom,
            to: [email],
            subject: 'Your Wilderness Almanac sign-in code',
            text: `Your Wilderness Almanac sign-in code is ${otp}. It expires in five minutes. If you did not request this code, you can ignore this email.`,
          });
          if (error) throw new Error('The sign-in email could not be sent. Please retry shortly.');
        },
      }),
    ],
  });
}
