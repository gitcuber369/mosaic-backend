import { Request, Response, NextFunction } from 'express';
import FirebaseAnalytics from '../firebaseConfig';

// Middleware to track API requests
export const analyticsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Track the request completion
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    
    // Track the API request
    FirebaseAnalytics.trackAPIUsage(
      req.originalUrl,
      req.method,
      res.statusCode,
      responseTime
    );
  });
  
  next();
};

// Middleware to track errors
export const errorAnalyticsMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Track the error
  FirebaseAnalytics.trackError(error, {
    endpoint: req.originalUrl,
    method: req.method,
    user_agent: req.get('User-Agent'),
    ip: req.ip,
  });
  
  next(error);
};