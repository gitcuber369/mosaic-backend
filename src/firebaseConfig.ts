import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
const initializeFirebase = () => {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      // For production: Use service account key file
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
      }
      // For development: Use default credentials (if running on Google Cloud)
      else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
      }
      // Fallback for local development
      else {
        console.warn('Firebase Admin SDK not initialized. Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS');
        return null;
      }
      
      console.log('Firebase Admin SDK initialized successfully');
    }
    
    return admin;
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    return null;
  }
};

// Analytics helper functions
export class FirebaseAnalytics {
  private static admin = initializeFirebase();

  // Track custom events
  static async trackEvent(eventName: string, parameters: Record<string, any> = {}) {
    if (!this.admin) {
      console.warn('Firebase not initialized, skipping analytics event');
      return;
    }

    try {
      // Always log analytics events to console
      console.log(`📊 Analytics Event: ${eventName}`, parameters);
      
      // Try to store in Firestore if available, but don't fail if not
      try {
        if (this.admin.firestore) {
          await this.admin.firestore().collection('analytics_events').add({
            event_name: eventName,
            parameters,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            server_timestamp: new Date().toISOString(),
          });
          console.log(`✅ Event "${eventName}" stored in Firestore`);
        }
      } catch (firestoreError) {
        // Firestore not available, but that's okay - we still logged the event
        console.log(`📝 Event "${eventName}" logged (Firestore not enabled)`);
      }
    } catch (error) {
      console.error('Error tracking analytics event:', error);
    }
  }

  // Track user events
  static async trackUserEvent(userId: string, eventName: string, parameters: Record<string, any> = {}) {
    await this.trackEvent(eventName, {
      ...parameters,
      user_id: userId,
    });
  }

  // Track API endpoint usage
  static async trackAPIUsage(endpoint: string, method: string, statusCode: number, responseTime?: number) {
    await this.trackEvent('api_request', {
      endpoint,
      method,
      status_code: statusCode,
      response_time_ms: responseTime,
    });
  }

  // Track errors
  static async trackError(error: Error, context?: Record<string, any>) {
    await this.trackEvent('server_error', {
      error_message: error.message,
      error_stack: error.stack,
      ...context,
    });
  }

  // Track user registration
  static async trackUserRegistration(userId: string, method: string = 'email') {
    await this.trackEvent('user_registration', {
      user_id: userId,
      registration_method: method,
    });
  }

  // Track subscription events
  static async trackSubscription(userId: string, planType: string, action: 'created' | 'updated' | 'cancelled') {
    await this.trackEvent('subscription_event', {
      user_id: userId,
      plan_type: planType,
      action,
    });
  }

  // Test Firebase connection
  static async testConnection(): Promise<boolean> {
    try {
      if (!this.admin) {
        console.log('❌ Firebase not initialized');
        return false;
      }

      console.log('✅ Firebase Admin SDK is connected!');
      
      // Test a simple analytics event
      await this.trackEvent('firebase_connection_test', { 
        timestamp: new Date().toISOString(),
        source: 'test_endpoint' 
      });

      return true;
    } catch (error) {
      console.error('❌ Firebase connection test failed:', error);
      return false;
    }
  }
}

export default FirebaseAnalytics;