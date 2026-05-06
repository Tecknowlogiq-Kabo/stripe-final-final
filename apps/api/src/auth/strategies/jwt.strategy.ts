import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
}

const cookieExtractor = (req: Request): string | null => {
  return req.cookies?.auth_token ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') as string,
    });
  }

  /** Returned value is attached to request.user */
  validate(payload: JwtPayload) {
    return { id: payload.sub, email: payload.email };
  }
}
