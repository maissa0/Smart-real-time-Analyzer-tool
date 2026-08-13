using System.Runtime.InteropServices;
using UnityEngine;

/// <summary>
/// Gestion de la clé électronique du jumeau numérique.
/// Attaché au GameObject "KeyRoot" (nouvel objet — ne touche à rien d'existant).
///
/// - Charge le modèle 3D depuis Resources/ElectronicCarKey.glb et le pose sur l'estrade.
/// - Position pilotée uniquement par les signaux CAN de la session (SetKeyZone
///   depuis Angular) — pas d'interaction souris.
/// - Zones (limite = l'estrade "Showroom_Podium", détectée automatiquement) :
///     inside  : la clé est dans l'emprise de la voiture
///     outside : la clé est autour de la voiture, sur l'estrade
///     unknown : la clé est hors de l'estrade (hors de portée)
/// - Panneau en haut à gauche : KEY POSITION → INSIDE / OUTSIDE / UNKNOWN.
/// - Côté site (Angular), même mécanisme que le snapshot :
///     * écoute :  window.addEventListener('unity-keystate', e => e.detail) // 'inside'|'outside'|'unknown'
///     * commande: unityInstance.SendMessage('KeyRoot', 'SetKeyZone', 'inside'|'outside'|'unknown')
///     * relire :  unityInstance.SendMessage('KeyRoot', 'RequestKeyState', '')
/// </summary>
public class KeyController : MonoBehaviour
{
    [Header("Zones (auto-configurees au demarrage)")]
    [Tooltip("Estrade servant de limite de detection. Laisser vide : trouvee par son nom Showroom_Podium.")]
    public Transform podium;
    public float podiumRadius = 3f;
    [Tooltip("Demi-largeur (X) et demi-longueur (Z) de la zone 'inside' autour du centre de la voiture.")]
    public Vector2 carHalfExtents = new Vector2(1.05f, 2.3f);

    [Header("Cle")]
    [Tooltip("Taille max de la cle en metres (l'echelle du modele est normalisee).")]
    public float keySize = 0.18f;
    public float keyHeight = 0.12f;

    GameObject key;
    Vector3 center;
    string state = "";
    bool dragging;
    float t;
    /// Volant (CarController.steering_wheel) — ancre de la zone "inside".
    Transform steeringWheel;
    /// Racine de la voiture — donne l'axe lateral pour placer la cle A COTE du volant.
    Transform carRoot;
    /// Hauteur de repos courante : keyHeight au sol, hauteur du volant en "inside".
    float baseHeight;
    /// true en zone "inside" : la cle se tient VERTICALE (debout) au lieu d'a plat.
    bool uprightPose;

    GUIStyle titleStyle, stateStyle;

#if UNITY_WEBGL && !UNITY_EDITOR
    // Implemente dans Assets/Plugins/WebGL/KeyBridge.jslib
    [DllImport("__Internal")] static extern void SendKeyStateToPage(string state);
#endif

    void Start()
    {
        GameObject pod = podium != null ? podium.gameObject : GameObject.Find("Showroom_Podium");
        if (pod != null)
        {
            center = pod.transform.position; center.y = 0f;
            podiumRadius = Mathf.Max(0.5f, pod.transform.localScale.x * 0.5f);
        }
        else
        {
            GameObject car = GameObject.Find("newCarBetter");
            if (car != null) { center = car.transform.position; center.y = 0f; }
        }

        // Ancre "inside" : le volant configure sur le CarController.
        CarController carCtrl = FindObjectOfType<CarController>();
        if (carCtrl != null)
        {
            steeringWheel = carCtrl.steering_wheel;
            carRoot = carCtrl.transform;
        }
        baseHeight = keyHeight;

        SpawnKey();
        // La cle reste INVISIBLE tant qu'Angular n'a pas envoye de zone :
        // une session sans donnees cle n'affiche pas de cle du tout.
        key.SetActive(false);
    }

    void SpawnKey()
    {
        GameObject prefab = Resources.Load<GameObject>("ElectronicCarKey");
        if (prefab != null)
        {
            key = Instantiate(prefab);
        }
        else
        {
            // Repli si le modele n'est pas importe : petit cube visible.
            key = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Collider c = key.GetComponent<Collider>();
            if (c != null) Destroy(c);
            Debug.LogWarning("[KeyController] Resources/ElectronicCarKey introuvable — cube de repli utilise.");
        }
        key.name = "ElectronicKey";

        // Normalise l'echelle du modele vers keySize.
        Renderer[] rends = key.GetComponentsInChildren<Renderer>();
        if (rends.Length > 0)
        {
            Bounds b = rends[0].bounds;
            for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
            float m = Mathf.Max(b.size.x, Mathf.Max(b.size.y, b.size.z));
            if (m > 0.0001f) key.transform.localScale *= keySize / m;
        }
    }

    void Update()
    {
        if (key == null || !key.activeSelf) return;

        // Position pilotee UNIQUEMENT par les signaux CAN de la session
        // (SetKeyZone depuis Angular) — pas d'interaction souris.

        // Petite animation pour reperer la cle facilement.
        // En "inside" la cle se tient debout (verticale) et tourne sur elle-meme.
        t += Time.deltaTime;
        Quaternion spin = Quaternion.Euler(0f, t * 40f, 0f);
        key.transform.rotation = uprightPose ? spin * Quaternion.Euler(90f, 0f, 0f) : spin;
        Vector3 pos = key.transform.position;
        pos.y = baseHeight + Mathf.Sin(t * 2f) * 0.02f;
        key.transform.position = pos;

        UpdateState();
    }

    void UpdateState()
    {
        Vector3 p = key.transform.position;
        float dx = Mathf.Abs(p.x - center.x);
        float dz = Mathf.Abs(p.z - center.z);
        float dist = Vector2.Distance(new Vector2(p.x, p.z), new Vector2(center.x, center.z));

        string s = (dx <= carHalfExtents.x && dz <= carHalfExtents.y) ? "inside"
                 : (dist <= podiumRadius) ? "outside"
                 : "unknown";

        if (s != state)
        {
            state = s;
            NotifyPage();
        }
    }

    void NotifyPage()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        SendKeyStateToPage(state);
#else
        Debug.Log("[KeyController] key state: " + state);
#endif
    }

    // ── Appels possibles depuis Angular (SendMessage sur 'KeyRoot') ──────
    /// <summary>
    /// Place la cle dans une zone : 'inside' | 'outside' | 'unknown'.
    /// 'hidden' masque la cle (aucune donnee cle au playhead / dans la session).
    /// Tout envoi d'une vraie zone re-affiche la cle.
    /// </summary>
    public void SetKeyZone(string zone)
    {
        if (key == null) return;
        if (zone == "hidden")
        {
            key.SetActive(false);
            state = "";
            return;
        }
        key.SetActive(true);
        uprightPose = zone == "inside";

        // "inside" : A COTE du volant (decalage lateral vers la portiere, le
        // long de l'axe droit de la voiture), a hauteur du volant, cle debout.
        if (zone == "inside" && steeringWheel != null)
        {
            Vector3 sw = steeringWheel.position;
            Vector3 right = carRoot != null ? carRoot.right : Vector3.right;
            right.y = 0f;
            if (right.sqrMagnitude < 0.001f) right = Vector3.right;
            right.Normalize();
            // Cote conducteur = le cote de la ligne mediane ou se trouve deja le volant.
            float side = Vector3.Dot(sw - center, right) >= 0f ? 1f : -1f;
            Vector3 p2 = sw + right * (side * 0.3f);
            baseHeight = sw.y;
            key.transform.position = new Vector3(p2.x, baseHeight, p2.z);
            UpdateState();
            return;
        }

        baseHeight = keyHeight;
        Vector3 p;
        switch (zone)
        {
            case "inside": p = center; break;   // repli si le volant est introuvable
            case "outside": p = center + new Vector3(Mathf.Max(1.6f, podiumRadius - 0.8f), 0f, 0f); break;
            default: p = center + new Vector3(podiumRadius + 3f, 0f, 0f); break;
        }
        key.transform.position = new Vector3(p.x, baseHeight, p.z);
        UpdateState();
    }

    /// <summary>Re-emet l'etat courant vers la page (evenement 'unity-keystate').
    /// Silencieux quand la cle est masquee (pas de donnees cle).</summary>
    public void RequestKeyState(string _)
    {
        if (key == null || !key.activeSelf) return;
        NotifyPage();
    }

    // ── Panneau haut-gauche ──────────────────────────────────────────────
    void OnGUI()
    {
        // Pas de panneau quand la cle est masquee (session sans donnees cle).
        if (key == null || !key.activeSelf) return;
        if (titleStyle == null)
        {
            titleStyle = new GUIStyle(GUI.skin.label)
            { fontSize = 13, fontStyle = FontStyle.Bold, normal = { textColor = new Color(1f, 1f, 1f, 0.75f) } };
            stateStyle = new GUIStyle(GUI.skin.label)
            { fontSize = 22, fontStyle = FontStyle.Bold };
        }

        Color c = state == "inside" ? new Color(0.30f, 0.90f, 0.45f)
                : state == "outside" ? new Color(1.00f, 0.72f, 0.20f)
                : new Color(0.75f, 0.75f, 0.80f);
        stateStyle.normal.textColor = c;

        GUI.Box(new Rect(12, 12, 200, 64), GUIContent.none);
        GUI.Box(new Rect(12, 12, 200, 64), GUIContent.none);
        GUI.Label(new Rect(26, 18, 180, 20), "KEY POSITION", titleStyle);
        GUI.Label(new Rect(26, 38, 180, 30), state.ToUpper(), stateStyle);
    }
}
