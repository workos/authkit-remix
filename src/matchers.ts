/* istanbul ignore file */

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeAResponse(): R;
      toBeOk(): R;
      toRedirect(path?: string): R;
      toHaveHeader(header: string, value?: string): R;
      toSetACookie(): R;
    }
  }
}

function isResponse(response: unknown): response is Response {
  return response instanceof Response;
}

function toBeAResponse(response: unknown) {
  const pass = isResponse(response);
  return {
    pass,
    message: () => {
      if (pass) {
        return 'Expected value to not be a Response object.';
      }
      return 'Expected value to be a Response object.';
    },
  };
}

function toBeOk(response: Response) {
  return {
    pass: response.ok,
    message: () => `Expected response to be ok, but got ${response.status} ${response.statusText}`,
  };
}

function toBeRedirect(response: Response | string, path?: string) {
  if (typeof response === 'string') {
    return {
      pass: response === path,
      message: () => {
        if (response === path) {
          return `The response shyould not redirect to ${path}`;
        }
        return `The response should redirect to ${path}, but it redirects to ${response}`;
      },
    };
  }

  const header = response.headers.get('Location');
  const status = response.status;
  const pass = status === 302 && header === path;

  return {
    pass,
    message: () => {
      if (pass) {
        return `The response should not redirect to ${path}`;
      }
      return `The response should redirect to ${path}, but it redirects to ${header}`;
    },
  };
}

function toHaveStatus(response: Response, status: number) {
  const pass = response.status === status;
  return {
    pass,
    message: () => {
      if (pass) {
        return `The status code of the response should not be ${status}.`;
      }
      return `The status code of the response should be ${status}, it was ${response.status}.`;
    },
  };
}

function toHaveHeader(response: Response, name: string, value?: string) {
  let pass = response.headers.has(name);
  if (!value) {
    return {
      pass,
      message: () => {
        if (pass) {
          return `The response should not have the header ${name}`;
        }
        return `The response should have the header ${name}`;
      },
    };
  }

  if (value) {
    pass = response.headers.get(name) === value;
  }

  return {
    pass,
    message: () => {
      if (pass) {
        return `The response should not have the header ${name} with the value ${value}`;
      }
      return `The response should have the header ${name} with the value ${value}`;
    },
  };
}

function toSetACookie(response: Response) {
  const pass = response.headers.has('Set-Cookie');
  return {
    pass,
    message: () => {
      if (pass) {
        return 'Expected the respoonse to not set a cookie.';
      }
      return 'Expected the response to set a cookie.';
    },
  };
}

expect.extend({
  toBeAResponse,
  toBeOk,
  toBeRedirect,
  toHaveStatus,
  toHaveHeader,
  toSetACookie,
});

export {};
