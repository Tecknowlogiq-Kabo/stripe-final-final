import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../entities/user.entity';

export interface JwtUser {
  id: string;
  email: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtUser }>();
    return request.user;
  },
);
