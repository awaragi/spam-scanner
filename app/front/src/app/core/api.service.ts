import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  login(password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.base}/auth/login`, {
      password,
    });
  }

  exchangeMailboxToken(
    adminToken: string,
    mailboxId: string,
  ): Observable<{ token: string }> {
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

  mailboxGet<T>(mailboxToken: string, mailboxId: string, path: string): Observable<T> {
    return this.http.get<T>(
      `${this.base}/mailboxes/${encodeURIComponent(mailboxId)}${path}`,
      { headers: this.bearer(mailboxToken) },
    );
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

  liveness(): Observable<{ status: string }> {
    return this.http.get<{ status: string }>(`${this.base}/health/live`);
  }

  private bearer(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
