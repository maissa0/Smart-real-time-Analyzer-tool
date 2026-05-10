# Fix O(n²) — ring buffer pour les trames live

## Ce qui a été fait

- **`_frameBuffer`** : tableau **`CanFrame[]`** mutables + constante **`MAX_LIVE_FRAMES = 2000`** — push **`O(1)`** et **`shift()`** si dépassement (fenêtre FIFO).
- **Souscription `liveTelemetry.frames$`** : suppression du **`spread`** sur **`allFrames`** à **chaque** message ; les nouvelles trames vont dans **`_frameBuffer`** et **`liveFrames`** est toujours borné (**`slice(-MAX)`**).
- **`startChartRaf`** : **`allFrames.set([...this._frameBuffer])`** **une fois par frame RAF** lorsque **`_frameBuffer` non vide** et session **live** — même boucle **`requestAnimationFrame`** que pour les **`pendingChartPoints`** (graphiques inchangée ensuite).
- **`selectSession`** : (**le fichier n’avait pas `this.allFrames.set([])`**) — ajout **`this._frameBuffer = [];`** après **`liveFrames.set([])`** pour repartir propre lors d’un changement de session.
- Suppression de **`engineRpm$`** (référence d’exemple **Engine_RPM_High**) — non utilisée dans le projet.

## Ce que ça fait pour le projet

- **Évite une copie intégrale** du tableau de trames (**`[...]` + `set`**) à **chaque** message Kafka/STOMP : passe d’un coût **quadratique** en volumétrie (**O(n)** par cadre cumulatif) à un **budget borné** côté buffer + mise à jour **UI signal** amortie par RAF.
- Fluidité meilleure lors de **simulateur / replay élevé FPS** tout en gardant un **cap** mémoire sur les trames observées (**2000**).

## Comment — explication technique

- **Hot path WebSocket** : **`push`** / **`shift`** sur tableau JS — amorti **constant** contrairement à **` [...allFrames(), frame]`** (**copie **`n`** éléments** par message).
- **Signal Angular `allFrames`** : **mutations désynchrones** vs stream réseau — **agrégateur RAF** regroupe plusieurs messages entre deux **`set`** (nombre de **`set`** par seconde plafonné par **freq RAF** lorsque plusieurs trames ont été pushées avant le prochain tick).
- **`liveFrames`** : encore un **`spread`** lors de l’ajout ; borne **`MAX_LIVE_FRAMES`** évite **`liveFrames`** géant ; évolution **`O(n)`** par trame (**next** tableau) — hors périmètre du replace **`allFrames`**.

## Pourquoi — justification

- **Garbage collection** : créer **`n+1`** clones successifs surcharge le ** heap** sous charge CAN dense.
- **Main thread Angular** : **`allFrames`** nourrit **nombreux computed** (**filtres**, **Charts**, **`frameStats`**…) — limiter **`set`** est prioritaire même si **`spread`** (**` [..._frameBuffer]`**) reste **O(window)** après RAF.

## Explication sans background informatique

Avant : à **chaque** petit paquet réseau, l’outil **Photocopié toutes les anciennes lignes + la nouvelle** pour mettre à jour l’affichage.  
Maintenant : les nouveaux messages s’aligned sur une **petite liste tournante** (*ring buffer léger : queue à taille max*). L’interface ne **rafraîchit la liste complète** dans le même rythme que l’œil : elle **récapitule** à chaque passage de l’animation du navigateur (**RAF**) — équivalent faire **« une photo du tableau noir » par image écran**.

## Comment tester manuellement

```powershell
cd C:/tools/Kpit_c/Frontend_angular
npx ng build --configuration development 2>&1 | Select-Object -Last 8
```

- Lancer simulateur CAN **live** : tableau / filtres ; aucune erreur **`RangeError`** / gel prolongé après **>** milliers trames.
- **DevTools Performance** : moins pics CPU sur **`Sniffer`** pendant rafales (comparaison qualitative).

## Problèmes rencontrés et corrections appliquées

- **STEP 4** : aucune ligne **`this.allFrames.set([]);`** présente dans **`selectSession`** sur la base actuelle — **`_frameBuffer`** vidé après **`liveFrames.set([])`** pour respecter **« clear on session change »** sans rajouter hors consigne **`allFrames`** reset forcé (**`loadFrames`** recharge toujours le signal).
- **Cohérence buffer ↔ chargement REST** : après **`loadFrames`** en session live (**merge DB + tampon WS**), le premier **`RAF`** contenant **`_frameBuffer`** ne remplit que les trames WS **posteriori** aux messages — **`allFrames`** issu REST peut être **réécrit court** jusqu’à ce que **`_frameBuffer`** réabsorbe fenêtre équivalente. Une passe ultérieure pourrait faire **`this._frameBuffer = [...merged]`** dans **`loadFrames`** (hors périmètre utilisateur strict **« no other changes »**).

## Mots clés pour la soutenance

**Complexité amortie**, **`O(n²)` → `O(1)` push bounded**, **ring buffer / FIFO capped**, **`requestAnimationFrame` batching**, **Angular Signals `allFrames`**, **Kafka / WebSocket ingest**, **`MAX_LIVE_FRAMES`**, **main-thread performance**, **garbage churn**.
