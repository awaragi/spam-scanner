import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** A response body paired with the `ETag` the server sent back for it -
 * the version an admin/mailbox-owner client must echo as `If-Match` on its
 * next mutation of the same resource (`persistent-mailbox-accounts`
 * design.md D4's optimistic-concurrency pattern). */
export interface WithEtag<T> {
  body: T;
  etag: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  login(password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.base}/auth/login`, {
      password,
    });
  }

  exchangeMailboxToken(adminToken: string, mailboxId: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(
      `${this.base}/auth/mailboxes/${encodeURIComponent(mailboxId)}/token`,
      {},
      { headers: this.bearer(adminToken) },
    );
  }

  adminGet<T>(adminToken: string, path: string): Observable<T> {
    return this.http.get<T>(`${this.base}${path}`, {
      headers: this.bearer(adminToken),
    });
  }

  adminGetWithEtag<T>(adminToken: string, path: string): Observable<WithEtag<T>> {
    return this.http
      .get<T>(`${this.base}${path}`, {
        headers: this.bearer(adminToken),
        observe: 'response',
      })
      .pipe(map((res) => ({ body: res.body as T, etag: res.headers.get('ETag') })));
  }

  adminPut<T>(adminToken: string, path: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${this.base}${path}`, body, {
      headers: this.bearer(adminToken),
    });
  }

  /** `POST`/`PATCH`/`PUT`/`DELETE` under `If-Match: "<version>"`, returning
   * the response body alongside the fresh `ETag` so the caller can chain
   * another mutation without a round-trip refetch. */
  adminWriteWithEtag<T>(
    adminToken: string,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    ifMatchVersion: number,
    body?: unknown,
  ): Observable<WithEtag<T>> {
    return this.http
      .request<T>(method, `${this.base}${path}`, {
        body: body ?? {},
        headers: this.bearer(adminToken).set('If-Match', `"${ifMatchVersion}"`),
        observe: 'response',
      })
      .pipe(map((res) => ({ body: res.body as T, etag: res.headers.get('ETag') })));
  }

  mailboxGet<T>(mailboxToken: string, mailboxId: string, path: string): Observable<T> {
    return this.http.get<T>(`${this.base}/mailboxes/${encodeURIComponent(mailboxId)}${path}`, {
      headers: this.bearer(mailboxToken),
    });
  }

  mailboxGetWithEtag<T>(
    mailboxToken: string,
    mailboxId: string,
    path: string,
  ): Observable<WithEtag<T>> {
    return this.http
      .get<T>(`${this.base}/mailboxes/${encodeURIComponent(mailboxId)}${path}`, {
        headers: this.bearer(mailboxToken),
        observe: 'response',
      })
      .pipe(map((res) => ({ body: res.body as T, etag: res.headers.get('ETag') })));
  }

  mailboxPost<T>(
    mailboxToken: string,
    mailboxId: string,
    path: string,
    body: unknown = {},
  ): Observable<T> {
    return this.http.post<T>(
      `${this.base}/mailboxes/${encodeURIComponent(mailboxId)}${path}`,
      body,
      { headers: this.bearer(mailboxToken) },
    );
  }

  mailboxPut<T>(
    mailboxToken: string,
    mailboxId: string,
    path: string,
    body: unknown,
  ): Observable<T> {
    return this.http.put<T>(
      `${this.base}/mailboxes/${encodeURIComponent(mailboxId)}${path}`,
      body,
      { headers: this.bearer(mailboxToken) },
    );
  }

  /** Same `If-Match`/`ETag` pattern as `adminWriteWithEtag`, scoped to the
   * calling mailbox's own routes (e.g. its persistent `PUT .../enabled`). */
  mailboxWriteWithEtag<T>(
    mailboxToken: string,
    mailboxId: string,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    ifMatchVersion: number,
    body?: unknown,
  ): Observable<WithEtag<T>> {
    return this.http
      .request<T>(method, `${this.base}/mailboxes/${encodeURIComponent(mailboxId)}${path}`, {
        body: body ?? {},
        headers: this.bearer(mailboxToken).set('If-Match', `"${ifMatchVersion}"`),
        observe: 'response',
      })
      .pipe(map((res) => ({ body: res.body as T, etag: res.headers.get('ETag') })));
  }

  mailboxDelete<T>(mailboxToken: string, mailboxId: string, path: string): Observable<T> {
    return this.http.delete<T>(`${this.base}/mailboxes/${encodeURIComponent(mailboxId)}${path}`, {
      headers: this.bearer(mailboxToken),
    });
  }

  liveness(): Observable<{ status: string }> {
    return this.http.get<{ status: string }>(`${this.base}/health/live`);
  }

  private bearer(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}

/** Parses the quoted-integer `ETag`/`If-Match` wire format
 * (`etagFor`/`requireIfMatchVersion` on the server) back into the plain
 * version number this client needs to send on its next mutation. */
export function parseEtagVersion(etag: string | null): number | null {
  if (etag === null) return null;
  const match = /^"?(\d+)"?$/.exec(etag.trim());
  return match ? Number(match[1]) : null;
}
