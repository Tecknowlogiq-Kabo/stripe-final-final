import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UserRole } from '../../entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

const cookieExtractor = (req: Request): string | null => {
  return req.cookies?.auth_token ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly previousSecret: string | undefined;

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('jwt.secret') as string;
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      // Provide both secrets as an array for rotation support.
      // passport-jwt tries secrets in order — current first, then previous.
      // This allows zero-downtime secret rotation:
      //   1. Set JWT_PREVIOUS_SECRET = old secret
      //   2. Set JWT_SECRET = new secret
      //   3. Wait 15 min for old tokens to expire
      //   4. Remove JWT_PREVIOUS_SECRET
      secretOrKeyProvider: (
        _request: Request,
        _rawJwtToken: string,
        done: (err: Error | null, secret: string | string[] | Buffer) => void,
      ) => {
        const previous = configService.get<string>('jwt.previousSecret');
        if (previous) {
          done(null, [secret, previous]);
        } else {
          done(null, secret);
        }
      },
    });
  }

  /** Returned value is attached to request.user */
  validate(payload: JwtPayload) {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
