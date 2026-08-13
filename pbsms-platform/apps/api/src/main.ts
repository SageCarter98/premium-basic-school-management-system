import { config } from 'dotenv';
import { resolve } from 'path';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Loads .env into process.env — nothing else in this scaffold did. src/ and
// (post-build) dist/ sit at the same depth under apps/api (nest-cli.json's
// sourceRoot mirrors it), so this relative path reaches pbsms-platform/.env
// the same way in dev and prod.
config({ path: resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // TEMPORARY, LOCAL-DEV-ONLY: permissive CORS so a browser-based demo page
  // can call this API directly during manual testing. helmet() and CORS
  // scoped to known frontend origins remain real Phase 1 items — this
  // permissive enableCors() is NOT that; it must be replaced (not extended)
  // before any non-local deployment.
  app.enableCors();

  // FR-API-010: reject unknown fields and coerce/validate DTOs on every
  // request body. helmet() and CORS scoped to known frontend origins remain
  // Phase 1 items, intentionally not pre-empted in this scaffold so they get
  // a real review rather than being copy-pasted.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`PBSMS API listening on port ${port}`);
}
bootstrap();
