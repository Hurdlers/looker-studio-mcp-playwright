import { GoogleAuth } from 'google-auth-library';

export interface TokenSource {
  token(): Promise<string>;
}

// Application Default Credentials (`gcloud auth application-default login`,
// or GOOGLE_APPLICATION_CREDENTIALS for a service account).
export function adcTokenSource(): TokenSource & { projectId(): Promise<string | undefined> } {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return {
    async token() {
      const token = await auth.getAccessToken();
      if (!token) throw new Error('No Application Default Credentials: run `gcloud auth application-default login`.');
      return token;
    },
    async projectId() {
      return auth.getProjectId().catch(() => undefined);
    },
  };
}
