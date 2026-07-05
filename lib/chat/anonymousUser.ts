const ANONYMOUS_USER_KEY = "pharmarev-ai-anonymous-user-key";

export function getOrCreateAnonymousUserKey() {
  if (typeof window === "undefined") {
    return "";
  }

  const existingKey = window.localStorage.getItem(ANONYMOUS_USER_KEY);

  if (existingKey) {
    return existingKey;
  }

  const newKey = crypto.randomUUID();

  window.localStorage.setItem(ANONYMOUS_USER_KEY, newKey);

  return newKey;
}