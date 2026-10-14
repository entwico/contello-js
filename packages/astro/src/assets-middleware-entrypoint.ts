import { contello } from 'virtual:@contello/astro/instance';

export const onRequest = contello.createAssetsMiddleware();
