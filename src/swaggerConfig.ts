
 import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AI Story Maker API',
      version: '1.0.0',
      description: 'API documentation for the AI Story Maker backend',
    },
    servers: [
      {
        url: 'https://mosaic-backend-dja0.onrender.com/', // Update this to match your Render URL
      },
    ],
  },
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'], // Path to the API docs
};

const specs = swaggerJSDoc(options);

export { swaggerUi, specs };
