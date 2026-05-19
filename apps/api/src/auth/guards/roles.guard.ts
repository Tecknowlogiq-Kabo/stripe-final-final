import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Require one or more roles on a route.
 * Usage: @Roles(UserRole.ADMIN) or @Roles(UserRole.ADMIN, UserRole.USER)
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => {
  return ((target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(ROLES_KEY, roles, descriptor.value);
    } else {
      Reflect.defineMetadata(ROLES_KEY, roles, target);
    }
  }) as MethodDecorator & ClassDecorator;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) {
      return true; // No role requirements — allow
    }

    const { user } = context.switchToHttp().getRequest<{ user: { role: UserRole } }>();
    if (!user) {
      return false;
    }
    return requiredRoles.includes(user.role);
  }
}
