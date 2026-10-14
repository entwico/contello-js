import { exclude } from 'virtual:@contello/astro/config';
import { contello } from 'virtual:@contello/astro/instance';

export const onRequest = contello.createRoutingMiddleware({ exclude: exclude ?? undefined });
