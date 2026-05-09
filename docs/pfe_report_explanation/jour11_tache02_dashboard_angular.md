# Jour 11 — Tâche 2 : Dashboard Angular — **`DashboardStore`** + cartes KPI + rafraîchissement 30 s

## Ce qui a été fait

- **`Frontend_angular/src/app/features/dashboard/dashboard.store.ts`** : **`signalStore`** **`@ngrx/signals`** (`providedIn: 'root'`) avec état **`stats`**, **`recentSessions`**, **`isLoading`**, **`error`** ; méthode **`loadStats()`** — double appel HTTP **`GET /api/dashboard/stats`** et **`GET /api/dashboard/recent-sessions?size=5`** avec en-tête **`Authorization: Bearer`** si **`access_token`** est présent dans **`localStorage`**.
- **`Frontend_angular/src/app/features/dashboard/dashboard.component.ts`** : remplacement du « Coming soon » par une **grille KPI** (sessions, trames, défauts intégrité, véhicules), **Top Message IDs**, **Fault Breakdown**, **Recent Sessions** ; conserve l’indicateur **WebSocket** via **`LiveTelemetryService`** ; **`interval(30_000)`** + **`takeUntilDestroyed`** pour **recharger** le store (aligné TTL cache backend **30 s**, côté UX).
- **Build Angular** développement : **Application bundle generation complete** (voir sortie ci‑dessous).

## Ce que ça fait pour le projet

- Le **routeur `/admin`** (page d’accueil dashboard) affiche des **vraies métriques** provenant du **`DashboardController`** sans recharger manuellement la page.
- Réutilise les **même patterns** que le reste du front (**`API_BASE_URL`**, token **`localStorage`**, **Signals** / **ngrx signals**).

## Comment — explication technique

1. **`DashboardStore`** : **`patchState`** sur succès/erreur du flux stats ; les sessions récentes sont mises à jour en parallèle (deux souscriptions indépendantes).
2. **`HttpHeaders`** : utilisation de **`new HttpHeaders({ Authorization: ... })`** au lieu d’un simple objet littéral pour respecter la signature **`HttpClient.get`** (Angular 21 / typage strict — voir problèmes).
3. **Template** : contrôle de flux **`@if` / `@for`** (Angular 17+), pipes **`number`** via **`DecimalPipe`** + **`CommonModule`**.

## Pourquoi — justification

- **Signal store** centralise l’état **lecture seule** du dashboard et évite de dupliquer **`HttpClient`** dans le composant.
- **Polling 30 s** : cohérent avec le **TTL Caffeine** côté **`/api/dashboard/stats`** — l’UI reflète les agrégats après invalidation du cache serveur.

## Explication sans background informatique

- La page **Tableau de bord** montre maintenant des **chiffres clés** (sessions, trames, anomalies, voitures, messages les plus fréquents) et les **dernières captures** ; ils se **mettent à jour toutes les 30 secondes** si l’application reste ouverte. Un **point vert/rouge** indique toujours si le flux **temps réel** WebSocket est connecté.

## Comment tester manuellement

Compilation develop :

```powershell
cd C:/tools/Kpit_c/Frontend_angular
npx ng build --configuration development 2>&1 | Select-Object -Last 10
```

**Sortie observée (dernières lignes)**

```
chunk-CRXYPOBG.js   | simulator-page-component    |   9.61 kB | 
chunk-DHCVPJSF.js   | code-verification-component |   9.43 kB | 
chunk-J3PMEW6B.js   | forgot-password-component   |   9.10 kB | 
chunk-EO5AQGCV.js   | sign-up-component           |   8.61 kB | 
...and 16 more lazy chunks files. Use "--verbose" to show all files.

Application bundle generation complete. [20.048 seconds] - 2026-05-09T20:38:49.119Z

Output location: C:\tools\Kpit_c\Frontend_angular\dist\user-management-platform


```

Manuellement :

1. Démarrer le **backend** puis **`ng serve`**.
2. Se connecter pour obtenir **`access_token`** dans **`localStorage`**.
3. Ouvrir **`/admin`** : vérifier chargement des cartes, défauts éventuels, liste des sessions.
4. Attendre **30 s** : le store rappelle **`loadStats()`** (rafraîchissement).

## Problèmes rencontrés et corrections appliquées

- **Échec `ng build` — typage des en-têtes HTTP** : un objet **`{ Authorization: ... }`** littéral ne satisfaisait pas **`HttpHeaders | Record<string, string | string[]>`** et provoquait des erreurs TS en cascade (ex. inférence **`ArrayBuffer`** sur le second **`GET`**). **Correction** : construire les en-têtes avec **`HttpHeaders`** depuis **`@angular/common/http`**, en conservant le comportement (Bearer si token présent).

## Mots clés pour la soutenance

**Angular standalone**, **`@ngrx/signals`**, **`signalStore`**, **`DashboardStore`**, **`API_BASE_URL`**, **`/api/dashboard/stats`**, **polling 30 s**, **KPI**, **`ng build`**, **Application bundle generation complete**
