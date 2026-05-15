# Chapitre 6 — Implémentation Frontend

## 6.1 Tableau de bord (Dashboard)

### 6.1.1 Évolution du tableau de bord

Le tableau de bord a évolué en deux phases distinctes au cours du développement.

---

**Figure 6.1 — Dashboard avant refonte (placeholder)**

![Dashboard placeholder](screenshots/dashboard_placeholder.png)

*État initial : le composant `DashboardComponent` affichait uniquement le
statut de connexion WebSocket et un message "Coming Soon". Aucune donnée
réelle n'était chargée — le backend n'exposait pas encore d'endpoint
de statistiques agrégées.*

---

**Figure 6.2 — Dashboard avec données réelles**

![Dashboard données réelles](screenshots/dashboard_live_data.png)

*État final après implémentation complète : KPI cards avec données réelles,
graphique de distribution des défauts (Chart.js doughnut), liste des sessions
récentes cliquables, actions rapides de navigation.*

---

### 6.1.2 Architecture technique du dashboard

#### Backend — DashboardController

L'endpoint `GET /api/dashboard/stats` agrège en **3 requêtes JPQL** :

1. **Session stats** — `COUNT`, `SUM(frameCount)`, `COUNT(status='live')`
   en une seule requête sur `CanSessionEntity`
2. **Fault breakdown** — `GROUP BY faultType` sur `IntegrityFaultEntity`
3. **Top 5 message IDs** — `GROUP BY msgId ORDER BY COUNT DESC` avec
   `Pageable(0, 5)` sur `CanFrameEntity`

Les résultats sont mis en cache **30 secondes** avec Caffeine
(`@Cacheable("dashboard-stats")`) pour éviter des scans complets sur
371 854 trames à chaque chargement de page.

```java
// DashboardController.java
@GetMapping("/stats")
@Cacheable("dashboard-stats")
public ResponseEntity<DashboardStatsDto> getStats() { ... }
```

#### Frontend — DashboardStore (NgRx Signals)

```typescript
// dashboard.store.ts
export const DashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => {
    // loadStats() appelle GET /api/dashboard/stats
    // et GET /api/dashboard/recent-sessions?size=5
  })
);
```

Le store expose 4 signaux : `stats`, `recentSessions`, `isLoading`, `error`.

#### Polling automatique — 30 secondes

```typescript
// dashboard.component.ts
interval(30_000)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe(() => this.store.loadStats());
```

`takeUntilDestroyed(destroyRef)` désabonne automatiquement l'observable
quand le composant est détruit — aucun `ngOnDestroy` nécessaire.

### 6.1.3 KpiCardComponent

`KpiCardComponent` est un composant Angular 17 autonome (standalone)
réutilisable avec des **signal inputs** (`input.required<T>()`).

Quand `isLive = true`, la bordure de la carte pulse en vert KPIT
`#b0ff44` via une animation CSS `kpi-pulse` :

```css
@keyframes kpi-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(176,255,68,0.0); }
  50%       { box-shadow: 0 0 0 4px rgba(176,255,68,0.25); }
}
```

### 6.1.4 Graphique de distribution des défauts

Le graphique de type **doughnut** (Chart.js 4.5) affiche la répartition
des défauts d'intégrité par type :

| Type | Couleur | Signification |
|---|---|---|
| `TIMING_GAP` | `#ff4444` rouge | Message reçu trop tard (> 3× le cycle nominal) |
| `DUPLICATE` | `#ffaa00` ambre | Message identique reçu dans < 1ms |
| Autre | `#8b949e` gris | Violation de plage de signal |

**Choix de design :**
- `cutout: '68%'` — anneau fin, plus lisible à la résolution projecteur
- `legend: { display: false }` — pas de légende Chart.js, remplacée par
  des labels texte à droite pour éviter les petits caractères illisibles
- `chart.update('none')` — mise à jour sans animation lors du rafraîchissement
  automatique des 30 secondes

### 6.1.5 Navigation depuis le dashboard

| Élément | Action | Route cible |
|---|---|---|
| Ligne session | Clic | `/admin/sniffer?sessionId=...` |
| Bouton Start Simulator | Clic | `/admin/simulator` |
| Bouton Upload Log | Clic | `/admin/upload` |
| Bouton Live Monitor | Clic | `/admin/monitor` |
| Bouton Vehicles | Clic | `/admin/vehicles` |
| View All → | Clic | `/admin/sniffer` |

### 6.1.6 Données affichées (production — 10 mai 2026)

| KPI | Valeur |
|---|---|
| Sessions | 88 |
| Total Frames | 369 344 |
| Integrity Faults | 153 |
| Vehicles | 3 |
| Top Message ID | 0x100 (36 349 frames) |
| Fault breakdown | SIGNAL_RANGE: 151 (99%) / TIMING_GAP: 2 (1%) |

---

## 6.2 Dépendances frontend — stratégie bundle vs CDN

### 6.2.1 Migration Chart.js — CDN vers bundle local

> "Chart.js was migrated from CDN loading to a bundled npm dependency (v4.x).
> This ensures the application functions in offline or network-restricted
> environments — a critical requirement for deployment in automotive workshop
> settings where internet access may be unavailable."

**Situation initiale (audit Day 12) :**

Le composant `SignalChartComponent` (page Sniffer) chargeait Chart.js
dynamiquement depuis un CDN externe :

```typescript
// Avant — dépendance réseau critique
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
document.head.appendChild(script);
```

**Problème :** si le réseau de la salle de soutenance ou de l'atelier
automobile est restreint, Chart.js ne se charge pas → graphiques vides →
démonstration compromise.

**Correction appliquée :**

```typescript
// Après — bundle local, zéro dépendance réseau
import {
  Chart, LineController, LineElement,
  PointElement, LinearScale, Filler, Tooltip,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);
```

### 6.2.2 Analyse du bundle (ng build --stats-json)

| Métrique | Valeur | Interprétation |
|---|---|---|
| `main.js` (chargement initial) | **12.4 KB** | Temps de premier rendu < 1 seconde |
| Total JS (tous chunks) | 2.59 MB | Répartis en chunks lazy-loaded |
| Plus grand chunk | 1079 KB | Page Sniffer — chargée à la demande |
| Chart.js dans le bundle | ~200 KB | Inclus uniquement dans dashboard + sniffer chunks |

**Conclusion :** le lazy loading Angular garantit que les 2.59 MB ne sont
jamais téléchargés en une seule fois. Le navigateur charge `main.js`
(12.4 KB) au premier accès, puis les chunks de chaque route à la demande.
La directive `@defer` (Angular 17+) n'est pas nécessaire — le bundle
initial est déjà optimal.

### 6.2.3 Composants Chart.js créés

| Composant | Type | Données | Couleurs |
|---|---|---|---|
| `MessageFrequencyChartComponent` | Bar | Top 5 msg_id par frame count | `#b0ff44` (KPIT vert) |
| `FaultDonutChartComponent` | Doughnut | Répartition défauts par type | Rouge / Ambre / Bleu |
| `SignalChartComponent` | Line | Signaux CAN temps réel | Par signal (palette) |

Chaque composant enregistre uniquement les modules Chart.js nécessaires
(`Chart.register(...)`) — tree-shaking réduit la taille du bundle par
rapport à un import global `import Chart from 'chart.js/auto'`.

### 6.2.4 Compatibilité offline

L'application complète fonctionne sans connexion internet après le
premier chargement (ou en développement local) :

- ✅ Chart.js — bundle local `node_modules`
- ✅ Tailwind CSS — généré au build, pas de CDN
- ✅ Angular Material icons — non utilisés (SVG inline)
- ✅ Fonts — système (`font-family: monospace` pour les IDs CAN)
- ⚠️ Backend API — requiert MySQL + Spring Boot en local
  (standard pour déploiement atelier automobile)

---

## 6.3 Live Monitor — Surveillance temps réel

### 6.3.1 Vue d'ensemble

La page Live Monitor (`/admin/monitor`) combine trois zones fonctionnelles :

1. **Sélecteur de véhicule** — filtre les sessions par véhicule via
   `GET /api/cars/{carUid}/sessions`. Quand "All Vehicles" est sélectionné,
   toutes les sessions apparaissent triées : sessions live en premier,
   puis par date décroissante.

2. **Cartes de session** — chaque session affiche son UUID (8 premiers
   caractères), le fichier source, le nombre de trames, et son statut
   (● Live / ✓ Done). La carte sélectionnée a une bordure `#b0ff44`.

3. **Live Frame Stream** — table de trames en temps réel avec :
   - **Pause/Resume** : les trames sont bufférisées (max 200) pendant
     la pause et injectées d'un coup à la reprise
   - **Filtre msg_id** : dropdown auto-populé depuis les IDs observés
   - **Auto-scroll** : `scrollTop = scrollHeight` après chaque trame
   - **Flash animation** : `@keyframes row-flash` sur chaque nouvelle ligne

### 6.3.2 Graphiques de signaux temps réel

**Figure 6.3 — Graphique de signaux CAN mis à jour en temps réel**

![Graphique temps réel — simulation CAN active](screenshots/monitor_live_chart.gif)

*Graphique de signaux CAN mis à jour à 60Hz pendant une session de
simulation active. Les courbes représentent les valeurs décodées des
signaux ECU (Engine_RPM_High, Vehicle_Speed, etc.) extraites en temps
réel depuis le bus CAN simulé.*

> "Figure 6.3 — Real-time signal chart updating at 60Hz during an active
> CAN simulation session."

**Technique d'implémentation :**

```typescript
// LiveTelemetryService — WebSocket STOMP subscription
this.rxStomp.watch('/topic/frames').subscribe(msg => {
  const frame = JSON.parse(msg.body);
  this.frameSubject.next(frame);  // pushed to frames$ Observable
});

// SignalChartComponent — Chart.js update sans animation
mc.chart.data.datasets[0].data.push(point);
mc.chart.update('none');  // 'none' = pas d'animation, maximum FPS
```

La fréquence de 60Hz est atteinte grâce à :
- `animation: false` sur tous les graphiques Chart.js
- `chart.update('none')` — mise à jour sans transition
- `parsing: false` — Chart.js utilise les données directement sans
  re-parser les objets JavaScript
- Batch broadcaster côté backend : `CanKafkaConsumer` émet les frames
  groupées à 60Hz vers le topic WebSocket `/topic/frames`

### 6.3.3 Thème KPIT des graphiques

Les graphiques du Monitor utilisent un thème sombre cohérent avec
l'identité visuelle KPIT :

| Élément | Valeur |
|---|---|
| Fond des graphiques | `#0d1117` |
| Bordure | `1px solid #1e2430` |
| Première série de chaque groupe | `#b0ff44` (vert KPIT) |
| Axes et grilles | `#1f2937` / `#374151` |
| Animation de pulse | `rgba(176,255,68,0.4)` sur réception de trame |

L'input `[kpitMonitorChartTheme]="true"` sur `<app-sniffer>` active
ce thème sans modifier le composant Sniffer pour les autres pages.

### 6.3.4 Filtrage par véhicule — implémentation

```typescript
// Sélection "All Vehicles" → GET /api/can/sessions
// Sélection véhicule → GET /api/cars/{carUid}/sessions
private loadSessions(carUid: string): void {
  const url = carUid
    ? `${API_BASE_URL}/api/cars/${carUid}/sessions`
    : `${API_BASE_URL}/api/can/sessions`;
  // Sessions triées : live en premier, puis createdAt DESC
}
```
