# Live Frame Table — pause, filter, auto-scroll

## Ce qui a été fait

- Refonte complète de **`Frontend_angular/src/app/features/monitor/monitor-page.component.ts`** : même page **standalone** (**`OnPush`**) avec **en-tête**, **filtre véhicule**, **cartes sessions** et une section dédiée **LIVE FRAME STREAM**.
- **Tableau** colonnes Timestamp, Msg ID, Name, Dir, Raw Bytes ; **sticky header**, zone scroll (**`max-height: 320px`**), lignes **`live-row`** avec animation flash à l’arrivée d’un lot.
- **Contrôle filtre Msg ID** : liste dérivée **`seenMsgIds`** (accumulation triée depuis chaque trame **`LiveTelemetryService.frames$`**), affichage **filtré** via **`displayedFrames`** (**`msgIdFilter`** signal).
- **Pause / Resume** : en pause les trames vont dans **`bufferedFrames`** (plafonné à **200**), badge **`+N`** sur le bouton ; au resume, **flush** dans le même pipeline **`appendFrames`**.
- **Auto-scroll** (case à cocher **`autoScroll`**) : après ajout, **`scrollTop = scrollHeight`** sur **`#frameTableWrap`** via **`setTimeout(..., 0)`** si activé.
- **Clear** : réinitialise **`liveFrames`**, **`bufferedFrames`**, **`displayedFrames`**.
- **Cap mémoire** : **`MAX_FRAMES = 500`** — conservation des **dernières** trames après concaténation.
- Section graphiques : **`app-sniffer`** avec **`hideUpload`**, **`hideSimulator`**, **`liveOnly`** (cohérence avec monitoring temps réel).

## Ce que ça fait pour le projet

- Le **Live Monitor** ne se limite plus aux métadonnées de sessions : il **montre concrètement** le flux CAN qui arrive par WebSocket, comme dans un sniffeur automobile.
- L’outil devient utilisable pour **démonstration jury** : on peut **ralentir mentalement la lecture** (pause), **cibler un identifiant** (filtre), et ** suivre ** le flux automatiquement (**auto-scroll**).

## Comment — explication technique

1. **`subscribeToFrames()`** dans **`ngOnInit`** : **`liveTelemetry.frames$.pipe(takeUntilDestroyed(...))`** — une souscription durable alignée avec le lifecycle du composant.
2. **Chemins données** :
   - actif **`!isPaused`** → **`appendFrames([frame])`** ;
   - pausé → **`bufferedFrames.update`** avec **`slice(-200)`**.
3. **`appendFrames`** : clone avec **`_isNew: true`**, **`liveFrames.update`** + troncature **`MAX_FRAMES`**, puis **`updateDisplayed()`** (application du filtre **`msgIdFilter`**).
4. **Affichage** : le template boucle sur **`displayedFrames()`** ; **`liveTelemetry.connected()`** pilote le message vide (connecté sans trames vs WebSocket fermé).

## Pourquoi — justification

- **Pause + buffer** : évite de perdre des trames pendant une inspection ou une prise de note, tout en bornant la RAM (**200 + 500 + tri msgId** maîtrisés).
- **Filtre par Msg ID** : pas d’endpoint dédié nécessaire côté monitor — les IDs **émmergent du flux**.
- **`OnPush` + signals** : cohérent avec le reste de l’app ; le flux WebSocket peut être très dense, d’où le **cap** et le **truncate** du champ raw.

## Explication sans background informatique

On affiche une **liste des messages** qui « passent sur le fil » en direct, comme un journal. On peut **mettre la lecture sur pause**, **voir combien de messages ont attendu**, **repartir**. On peut **montrer seulement un type de message** (filtre ID). La liste peut **suivre le bas automatiquement** ou non, et **vider** l’écran quand besoin — sans avoir besoin du vocabulaire API ou WebSocket.

## Comment tester manuellement

```powershell
cd C:/tools/Kpit_c/Frontend_angular
npx ng build --configuration development 2>&1 | Select-Object -Last 8
```

Navigation **route Monitor** (`/monitor` ou équivalent du routing) :

- Backend + frontend démarrés, **simulateur CAN** qui pousse du live : la table **se remplit** ; en-tête compteur **`N frames`**.
- Changer **Filter** vers un Msg ID précis → seules les lignes correspondantes.
- **Pause** → influx stoppé dans le tableau, badge **`+`** si trames tamponnées ; **Resume** → les trames retardées **réinjectées**.
- Décocher **Auto-scroll**, ajouter beaucoup de trames → la vue **ne force plus** le bas ; recocher + nouvelles trames → défilement en bas.
- **Clear** → tableau vide jusqu’aux prochaines trames.
- Vérifier **état hors connexion** (backend arrêté) : message **WebSocket disconnected**.

## Problèmes rencontrés et corrections appliquées

- **Premier build KO** : **`TS2339`** — le modèle **`CanFrame`** du projet utilise la clé **`id`** (numérique), pas **`frameId`** (réservé à **`IntegrityFault`**). La boucle **`@for(..., track)`** du template a donc été alignée sur **`track f.id`** pour que **`ng build`** réussisse.
- **Diagnostics Angular** (optionnels) : avertissements **`NG8107` / `NG8102`** sur **`?.`** et **`??`** dans le template — cosmetiques tant que **`strictTemplates`** tolère ces branches.

## Mots clés pour la soutenance

**Live Monitor**, **table temps réel**, **WebSocket / STOMP** (`frames$`), **signals Angular**, **`OnPush`**, **pause / buffer / flush**, **filtre Msg ID**, **auto-scroll**, **sticky table header**, **plafonnement mémoire** (`MAX_FRAMES`), **`LiveTelemetryService`**, **UX démonstration CAN**.
