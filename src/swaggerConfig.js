const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

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
        url: 'https://mosaic-backend-0.onrender.com/', // Update this to match your server URL
      },
    ],
  },
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs,
};
