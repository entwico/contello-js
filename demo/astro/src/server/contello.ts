import { createContello } from '@contello/astro';
import { Config } from '@/config';
import { schema } from '@/server/_/contello/graphql';

export const contello = createContello({ ...Config.services.contello, schema });
