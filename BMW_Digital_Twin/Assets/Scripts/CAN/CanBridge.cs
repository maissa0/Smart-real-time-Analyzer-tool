using System;
using System.Collections;
using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;

/// <summary>
/// Entry point for live CAN data coming from the Angular app via Unity's
/// WebGL JavaScript bridge. Attach to the same GameObject as CarController.
///
/// JS side calls:
///   unityInstance.SendMessage('CarRoot', 'ApplySignal', 'Drd_Status:1');
///
/// Message format is "<signal_name>:<raw_value>" — exactly the signal_name
/// and raw_value fields already produced by the Python decoder / catalogues
/// (see python_parser/catalogues/*.xml and Frontend_angular's DecodedSignal model).
/// "CarRoot" must match the name of the GameObject this script is attached to.
/// </summary>
[RequireComponent(typeof(CarController))]
public class CanBridge : MonoBehaviour
{
    [Header("Steering PiP Camera")]
    [Tooltip("Cockpit camera aimed at the steering wheel. Assign in the Inspector. " +
             "Disabled at startup; toggled on/off by the Angular 'Show Steering' button.")]
    public Camera steeringCamera;

    private CarController car;
    private ShowroomCamera showroomCamera;

#if UNITY_WEBGL && !UNITY_EDITOR
    // Implemented in Assets/Plugins/WebGL/SnapshotBridge.jslib — forwards the
    // base64 PNG to the browser as a 'unity-snapshot' CustomEvent.
    [DllImport("__Internal")]
    private static extern void SendSnapshotToPage(string base64);
#endif

    void Awake()
    {
        car = GetComponent<CarController>();
        if (steeringCamera != null) steeringCamera.gameObject.SetActive(false);
        showroomCamera = FindObjectOfType<ShowroomCamera>();
    }

    /// <summary>
    /// JS side: unityInstance.SendMessage('CarRoot', 'CaptureSnapshot', '').
    /// Grabs the current rendered frame and returns it to the page as a base64
    /// PNG (via SnapshotBridge.jslib) for the Angular fault-report PDF.
    /// </summary>
    public void CaptureSnapshot(string _)
    {
        StartCoroutine(CaptureSnapshotRoutine());
    }

    private IEnumerator CaptureSnapshotRoutine()
    {
        // Must run after the frame is fully drawn, or the read-back is blank.
        yield return new WaitForEndOfFrame();

        Texture2D tex = null;
        try
        {
            tex = ScreenCapture.CaptureScreenshotAsTexture();
            byte[] png = tex.EncodeToPNG();
            string base64 = Convert.ToBase64String(png);
#if UNITY_WEBGL && !UNITY_EDITOR
            SendSnapshotToPage(base64);
#else
            Debug.Log($"[CanBridge] Snapshot captured ({png.Length} bytes) — WebGL bridge only forwards in a browser build.");
#endif
        }
        finally
        {
            if (tex != null) Destroy(tex);
        }
    }

    /// <summary>
    /// JS side: unityInstance.SendMessage('CarRoot', 'SetSteeringCam', '1' | '0').
    /// Toggles the steering-wheel PiP camera on/off.
    /// </summary>
    public void SetSteeringCam(string value)
    {
        if (steeringCamera == null) return;
        steeringCamera.gameObject.SetActive(value == "1");
    }

    /// <summary>
    /// JS side: unityInstance.SendMessage('CarRoot', 'SetOrbitSpeed', '0'..'90').
    /// Rotation-speed slider in the Angular twin-tab toolbar (°/s, 0 = stopped).
    /// </summary>
    public void SetOrbitSpeed(string value)
    {
        if (!float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out float dps))
            return;
        if (showroomCamera == null) showroomCamera = FindObjectOfType<ShowroomCamera>();
        if (showroomCamera != null) showroomCamera.SetOrbitSpeed(dps);
    }

    /// <summary>
    /// JS side: unityInstance.SendMessage('CarRoot', 'SetEventFocus', '1' | '0').
    /// Angular's Focus On/Off toggle — '0' disables event focus and eases any
    /// in-flight focus back into the normal orbit.
    /// </summary>
    public void SetEventFocus(string value)
    {
        if (showroomCamera == null) showroomCamera = FindObjectOfType<ShowroomCamera>();
        if (showroomCamera != null) showroomCamera.SetFocusEnabled(value == "1");
    }

    /// <summary>
    /// JS side: unityInstance.SendMessage('CarRoot', 'FocusPart', 'door_fl' | ...).
    /// Event focus: swings the showroom camera around to the part that just
    /// animated so it fills the view for a few seconds (see ShowroomCamera.FocusOn).
    /// </summary>
    public void FocusPart(string part)
    {
        if (showroomCamera == null) showroomCamera = FindObjectOfType<ShowroomCamera>();
        if (showroomCamera == null) return;

        Transform t = ResolvePartTransform(part);
        if (t == null) return;

        showroomCamera.FocusOn(RendererCenter(t));
    }

    /// <summary>Part id → scene transform. Windows focus on their door (the
    /// glass animators live under the door hierarchy); wipers on the left arm.</summary>
    private Transform ResolvePartTransform(string part)
    {
        switch (part)
        {
            case "door_fl": case "window_fl": return car.door_fl;
            case "door_fr": case "window_fr": return car.door_fr;
            case "door_rl": case "window_rl": return car.door_rl;
            case "door_rr": case "window_rr": return car.door_rr;
            case "hood": return car.hood;
            case "trunk": return car.trunk;
            case "wheel_fl": return car.wheel_fl;
            case "wheel_fr": return car.wheel_fr;
            case "wheel_rl": return car.wheel_rl;
            case "wheel_rr": return car.wheel_rr;
            case "wiper": return car.wiper_left != null ? car.wiper_left : car.wiper_right;
            case "steering": return car.steering_wheel;
            case "key":
                // Spawned at runtime by KeyController — not a CarController field.
                GameObject key = GameObject.Find("ElectronicKey");
                return key != null ? key.transform : null;
            default: return null;
        }
    }

    /// <summary>Visual center of the part — pivots sit on hinges (door edge,
    /// hood rear), so aiming at the renderer bounds frames the part properly.</summary>
    private static Vector3 RendererCenter(Transform t)
    {
        Renderer[] rends = t.GetComponentsInChildren<Renderer>();
        if (rends.Length == 0) return t.position;

        Bounds b = rends[0].bounds;
        for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
        return b.center;
    }

    public void ApplySignal(string message)
    {
        int sep = message.IndexOf(':');
        if (sep < 0) return;

        string signalName = message.Substring(0, sep);
        string rawValue = message.Substring(sep + 1);

        if (!float.TryParse(rawValue, NumberStyles.Float, CultureInfo.InvariantCulture, out float value))
            return;

        bool isSet = value != 0f;

        switch (signalName)
        {
            case "Drd_Status": car.SetDoorState("fl", isSet); break;
            case "PSD_Status": car.SetDoorState("fr", isSet); break;
            case "DRDR_Status": car.SetDoorState("rl", isSet); break;
            case "Psdr_Status": car.SetDoorState("rr", isSet); break;
            case "Bootlid_Status": car.SetTrunkState(isSet); break;
            case "Hood_Status": car.SetHoodState(isSet); break;
            case "Wiper_State": car.SetWipers(isSet); break;

            case "Window_FL": car.SetWindowOpenState("fl", isSet); break;
            case "Window_FR": car.SetWindowOpenState("fr", isSet); break;
            case "Window_RL": car.SetWindowOpenState("rl", isSet); break;
            case "Window_RR": car.SetWindowOpenState("rr", isSet); break;

            case "SteeringAngle_High":
                car.SetSteeringAngle(SteeringEnumToDegrees((int)value));
                break;

            case "Wheel_Speed_FL":
            case "Wheel_Speed_FR":
            case "Wheel_Speed_RL":
            case "Wheel_Speed_RR":
                car.SetWheelSpeed(WheelSpeedEnumToRevs((int)value));
                break;

            default:
                // Unmapped signal — safe to ignore. Add a case above once you
                // confirm the exact signal_name from the sniffer's Table tab.
                break;
        }
    }

    // SteeringAngle_High enum (powertrain_can.xml 0x102):
    // 0 Center, 1 Slight_Left, 2 Hard_Left, 3 Slight_Right,
    // 4 Hard_Right, 5 Full_Lock_Left, 6 Full_Lock_Right.
    // Left = negative degrees, right = positive.
    static float SteeringEnumToDegrees(int enumValue)
    {
        switch (enumValue)
        {
            case 1: return -30f;
            case 2: return -70f;
            case 3: return 30f;
            case 4: return 70f;
            case 5: return -110f;
            case 6: return 110f;
            default: return 0f;
        }
    }

    // Wheel_Speed_* enum (chassis_can.xml 0x200):
    // 0 Stationary, 1 Slow, 2 Normal, 3 Fast → revolutions/sec for wheel spin.
    static float WheelSpeedEnumToRevs(int enumValue)
    {
        switch (enumValue)
        {
            case 1: return 0.5f;
            case 2: return 1.5f;
            case 3: return 3f;
            default: return 0f;
        }
    }
}
