// Manifest de la app web (src/lib/manifest.ts). No consulta D1.
import type { APIRoute } from 'astro'
import { manifestResponse } from '../lib/manifest'

export const GET: APIRoute = () => manifestResponse()
