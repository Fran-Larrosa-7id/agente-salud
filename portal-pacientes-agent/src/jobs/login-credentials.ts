export interface LoginCredentials {
  username: string;
  password: string;
  providerTermsAccepted?: boolean;
}

/** Owned by one runner, outside the job, its event history and storage checkpoints. */
export class OneUseLogin {
  #value: LoginCredentials | undefined;

  constructor(value: LoginCredentials) {
    this.#value = { ...value };
  }

  take(): LoginCredentials | undefined {
    const value = this.#value;
    this.revoke();
    return value;
  }

  revoke(): void {
    this.#value = undefined;
  }
}
