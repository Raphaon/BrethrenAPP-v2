import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './index';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BrethrenApp API',
      version: '1.0.0',
      description:
        'API REST pour la gestion des eglises, membres, assemblees, evenements, actualites, boutique, finances et statistiques BrethrenApp.',
      contact: {
        name: 'Support BrethrenApp',
        email: 'support@brethrenapp.com',
      },
    },
    servers: [
      {
        url: `http://localhost:${config.PORT}/api/${config.API_VERSION}`,
        description: 'Serveur de développement',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Token manquant ou invalide',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        ForbiddenError: {
          description: 'Accès refusé — permissions insuffisantes',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        NotFoundError: {
          description: 'Ressource introuvable',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        ValidationError: {
          description: 'Données de requête invalides',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ValidationErrorResponse',
              },
            },
          },
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            code: { type: 'string' },
          },
        },
        ValidationErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Validation error' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: {} },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
                hasNext: { type: 'boolean' },
                hasPrev: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentification et gestion des sessions' },
      { name: 'Users', description: 'Gestion des utilisateurs' },
      { name: 'Roles', description: 'Gestion des rôles' },
      { name: 'Permissions', description: 'Gestion des permissions' },
      { name: 'Regions', description: 'Gestion des régions' },
      { name: 'Districts', description: 'Gestion des districts' },
      { name: 'Assemblies', description: 'Gestion des assemblées' },
      { name: 'Preaching Points', description: "Gestion des points de prêche" },
      { name: 'Members', description: 'Gestion des membres' },
      { name: 'Pastors', description: 'Gestion des pasteurs et responsables' },
      { name: 'Assignments', description: 'Gestion des affectations' },
      { name: 'Ministries', description: 'Gestion des ministères et groupes' },
      { name: 'Announcements', description: 'Gestion des annonces et publications' },
      { name: 'Circulars', description: 'Gestion des circulaires' },
      { name: 'Events', description: 'Gestion des événements' },
      { name: 'Transfers', description: 'Gestion des transferts de membres' },
      { name: 'Notifications', description: 'Gestion des notifications' },
      { name: 'Audit Logs', description: "Journal d'audit" },
      { name: 'Statistics', description: 'Statistiques et tableau de bord' },
      { name: 'Conversations', description: 'Messagerie interne' },
    ],
  },
  apis: ['./src/modules/**/*.routes.ts', './src/modules/**/*.controller.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
