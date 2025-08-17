declare module './swaggerConfig' {
  import { OpenAPIV3 } from 'openapi-types';
  import { RequestHandler } from 'express';

  export const swaggerUi: {
    serve: RequestHandler;
    setup: (specs: OpenAPIV3.Document) => RequestHandler;
  };

  export const specs: OpenAPIV3.Document;
}
