import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LogOut, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface AuthUser {
  username: string;
  name?: string;
  email?: string;
  roles: string[];
}

export interface AuthMe {
  strategy: 'basic' | 'keycloak';
  user: AuthUser;
  logoutUrl: string | null;
}

function isAuthMe(value: unknown): value is AuthMe {
  const me = value as AuthMe | null;
  return !!me && typeof me === 'object' && !!me.user && typeof me.user.username === 'string';
}

/**
 * `auth/me` sits next to the board, so it resolves against the document's <base> rather than
 * the API base path. Anything but a 200 with the expected body (404 when no auth is configured,
 * a network error, an HTML login page) means there is no signed-in user to show.
 */
export async function fetchAuthMe(): Promise<AuthMe | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(new URL('auth/me', document.baseURI), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (response.status !== 200) return null;
    const body: unknown = await response.json();
    return isAuthMe(body)
      ? { ...body, user: { ...body.user, roles: body.user.roles ?? [] } }
      : null;
  } catch {
    return null;
  }
}

export function getInitials(user: AuthUser): string {
  const source = (user.name || user.username || '').trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  const initials =
    parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : source.slice(0, 2);
  return initials.toUpperCase() || '?';
}

export const UserMenu = () => {
  const { t } = useTranslation();
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchAuthMe,
    staleTime: Infinity,
    retry: false,
  });

  if (!me) return null;

  const { user, logoutUrl, strategy } = me;
  const displayName = user.name || user.username;
  const initials = getInitials(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('USER.MENU')}
          className="group flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 outline-none transition-colors animate-in fade-in-0 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-linear-to-br from-primary/80 to-chart-2/80 text-[0.65rem] font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium lg:inline">
            {displayName}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 text-muted-foreground transition-transform duration-200 group-aria-expanded:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 p-2 font-normal">
          <Avatar className="size-10">
            <AvatarFallback className="bg-linear-to-br from-primary/80 to-chart-2/80 text-sm font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email || user.username}
            </span>
          </span>
        </DropdownMenuLabel>
        {user.roles.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup className="px-2 py-1.5">
              <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {t('USER.ROLES')}
              </p>
              <div className="flex flex-wrap gap-1">
                {user.roles.map((role) => (
                  <Badge key={role} variant="secondary" className="font-mono text-[0.65rem]">
                    {role}
                  </Badge>
                ))}
              </div>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-[0.7rem] text-muted-foreground">
          {t('USER.SIGNED_IN_WITH', { strategy: strategy === 'keycloak' ? 'Keycloak' : 'Basic' })}
        </p>
        {!!logoutUrl && (
          <DropdownMenuItem variant="destructive" asChild>
            <a href={logoutUrl}>
              <LogOut aria-hidden="true" />
              {t('USER.SIGN_OUT')}
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
