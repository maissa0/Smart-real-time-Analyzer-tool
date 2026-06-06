using UnityEngine;
using System.Collections;
using System.Collections.Generic;

public class CarController : MonoBehaviour
{
    [System.Serializable]
    public class WindowAnimatorEntry
    {
        [Tooltip("Window id used from code/CAN bridge. Example: fl, fr, rl, rr")]
        public string id = "fl";

        [Tooltip("Animator on the glass object")]
        public Animator animator;

        [Tooltip("State name that plays the CLOSE animation (open -> closed)")]
        public string closeStateName = "WindowClose";

        [Tooltip("Initial state at scene start")]
        public bool startsOpen = false;
    }

    [Header("Doors")]
    public Transform door_fl;
    public Transform door_fr;
    public Transform door_rl;
    public Transform door_rr;

    [Header("Hood & Trunk")]
    public Transform hood;
    public Transform trunk;

    [Header("Steering Wheel")]
    public Transform steering_wheel;

    [Header("Wheels")]
    public Transform wheel_fl;
    public Transform wheel_fr;
    public Transform wheel_rl;
    public Transform wheel_rr;

    [Header("Wipers")]
    public Transform wiper_left;
    public Transform wiper_right;

    [Header("Windows (Glass Animators)")]
    public WindowAnimatorEntry[] windows;

    [Header("CAN Data — Doors")]
    public bool door_fl_open = false;
    public bool door_fr_open = false;
    public bool door_rl_open = false;
    public bool door_rr_open = false;

    [Header("CAN Data — Hood & Trunk")]
    public bool hood_open = false;
    public bool trunk_open = false;

    [Header("CAN Data — Windows")]
    public bool window_fl_open = false;
    public bool window_fr_open = false;
    public bool window_rl_open = false;
    public bool window_rr_open = false;

    [Header("CAN Data — Motion")]
    public float steering_angle = 0f;
    public float wheel_speed = 0f;
    public bool wipers_on = false;

    [Header("Animation Settings")]
    public float door_open_angle = 45f;
    public float hood_open_angle = 45f;
    public float trunk_open_angle = 45f;
    public float animation_speed = 2f;
    public float wiper_sweep_angle = 60f;

    [Header("Axis Settings")]
    public int door_fl_axis = 1;
    public int door_fr_axis = -1;
    public int door_rl_axis = 1;
    public int door_rr_axis = -1;
    public int hood_axis = 1;
    public int trunk_axis = -1;
    public int wheel_axis = 1;
    public int steering_axis = 1;
    public int wiper_axis = 1;
    public int wiper_left_axis = 1;
    public int wiper_right_axis = -1;

    // Initial rotations saved at Start
    private Vector3 init_door_fl;
    private Vector3 init_door_fr;
    private Vector3 init_door_rl;
    private Vector3 init_door_rr;
    private Vector3 init_hood;
    private Vector3 init_trunk;
    private Vector3 init_steering;
    private Vector3 init_wiper_left;
    private Vector3 init_wiper_right;
    private Quaternion init_steering_rot;
    private Quaternion init_wiper_left_rot;
    private Quaternion init_wiper_right_rot;

    // Wheel rotation accumulator
    private float wheel_rot = 0f;

    // Wiper
    private float wiper_angle = 0f;
    private float wiper_dir = 1f;

    // Window animation runtime state (normalized 0..1 of close clip)
    private readonly Dictionary<string, float> windowProgress = new Dictionary<string, float>();
    private readonly Dictionary<string, Coroutine> windowRoutines = new Dictionary<string, Coroutine>();
    private bool last_window_fl_open;
    private bool last_window_fr_open;
    private bool last_window_rl_open;
    private bool last_window_rr_open;

    void Start()
    {
        // Save initial LOCAL euler angles
        if (door_fl != null) init_door_fl = door_fl.localEulerAngles;
        if (door_fr != null) init_door_fr = door_fr.localEulerAngles;
        if (door_rl != null) init_door_rl = door_rl.localEulerAngles;
        if (door_rr != null) init_door_rr = door_rr.localEulerAngles;
        if (hood != null) init_hood = hood.localEulerAngles;
        if (trunk != null) init_trunk = trunk.localEulerAngles;
        if (steering_wheel != null) init_steering = steering_wheel.localEulerAngles;
        if (wiper_left != null) init_wiper_left = wiper_left.localEulerAngles;
        if (wiper_right != null) init_wiper_right = wiper_right.localEulerAngles;
        if (steering_wheel != null) init_steering_rot = steering_wheel.localRotation;
        if (wiper_left != null) init_wiper_left_rot = wiper_left.localRotation;
        if (wiper_right != null) init_wiper_right_rot = wiper_right.localRotation;

        InitializeWindows();
        last_window_fl_open = window_fl_open;
        last_window_fr_open = window_fr_open;
        last_window_rl_open = window_rl_open;
        last_window_rr_open = window_rr_open;

        // Apply initial inspector window state once at startup.
        SetWindowState("fl", window_fl_open);
        SetWindowState("fr", window_fr_open);
        SetWindowState("rl", window_rl_open);
        SetWindowState("rr", window_rr_open);
    }

    void Update()
    {
        AnimateDoors();
        AnimateHood();
        AnimateTrunk();
        AnimateSteering();
        AnimateWheels();
        AnimateWipers();
        SyncWindowsFromInspector();
        HoldWindowTargets();
    }

    void AnimateDoors()
    {
        AnimateDoor(door_fl, init_door_fl,
            door_fl_open, door_open_angle * door_fl_axis, "Y");
        AnimateDoor(door_fr, init_door_fr,
            door_fr_open, door_open_angle * door_fr_axis, "Y");
        AnimateDoor(door_rl, init_door_rl,
            door_rl_open, door_open_angle * door_rl_axis, "Y");
        AnimateDoor(door_rr, init_door_rr,
            door_rr_open, door_open_angle * door_rr_axis, "Y");
    }

    void AnimateDoor(Transform t, Vector3 initEuler,
                     bool open, float angle, string axis)
    {
        if (t == null) return;
        float target = open ? angle : 0f;
        float current = GetAxis(t.localEulerAngles, axis);
        float initVal = GetAxis(initEuler, axis);

        // Normalize current
        float cur = current - initVal;
        if (cur > 180f) cur -= 360f;
        if (cur < -180f) cur += 360f;

        float newVal = Mathf.LerpAngle(cur, target,
            Time.deltaTime * animation_speed);

        SetAxis(t, initEuler, newVal, axis);
    }

    void AnimateHood()
    {
        if (hood == null) return;
        float target = hood_open ? hood_open_angle * hood_axis : 0f;
        float current = hood.localEulerAngles.x - init_hood.x;
        if (current > 180f) current -= 360f;
        if (current < -180f) current += 360f;
        float newVal = Mathf.LerpAngle(current, target,
            Time.deltaTime * animation_speed);
        hood.localEulerAngles = new Vector3(
            init_hood.x + newVal,
            init_hood.y,
            init_hood.z);
    }

    void AnimateTrunk()
    {
        if (trunk == null) return;
        float target = trunk_open ? trunk_open_angle * trunk_axis : 0f;
        float current = trunk.localEulerAngles.x - init_trunk.x;
        if (current > 180f) current -= 360f;
        if (current < -180f) current += 360f;
        float newVal = Mathf.LerpAngle(current, target,
            Time.deltaTime * animation_speed);
        trunk.localEulerAngles = new Vector3(
            init_trunk.x + newVal,
            init_trunk.y,
            init_trunk.z);
    }

    void AnimateSteering()
    {
        if (steering_wheel == null) return;
        steering_wheel.localRotation = init_steering_rot * Quaternion.AngleAxis(
            steering_angle * steering_axis,
            Vector3.up);
    }

    void AnimateWheels()
    {
        if (wheel_speed == 0f) return;

        if (wheel_fl != null)
            wheel_fl.Rotate(Vector3.right * wheel_speed *
                wheel_axis * Time.deltaTime * 360f, Space.Self);
        if (wheel_fr != null)
            wheel_fr.Rotate(Vector3.right * wheel_speed *
                wheel_axis * Time.deltaTime * 360f, Space.Self);
        if (wheel_rl != null)
            wheel_rl.Rotate(Vector3.right * wheel_speed *
                wheel_axis * Time.deltaTime * 360f, Space.Self);
        if (wheel_rr != null)
            wheel_rr.Rotate(Vector3.right * wheel_speed *
                wheel_axis * Time.deltaTime * 360f, Space.Self);
    }

    void AnimateWipers()
    {
        if (!wipers_on)
        {
            wiper_angle = Mathf.LerpAngle(wiper_angle, 0f,
                Time.deltaTime * animation_speed);
            ApplyWipers();
            return;
        }

        wiper_angle += wiper_dir * wiper_sweep_angle *
                       Time.deltaTime * animation_speed;

        if (wiper_angle >= wiper_sweep_angle)
        {
            wiper_angle = wiper_sweep_angle;
            wiper_dir = -1f;
        }
        else if (wiper_angle <= 0f)
        {
            wiper_angle = 0f;
            wiper_dir = 1f;
        }

        ApplyWipers();
    }

    void ApplyWipers()
    {
        if (wiper_left != null)
            wiper_left.localRotation = init_wiper_left_rot * Quaternion.AngleAxis(
                wiper_angle * wiper_axis * wiper_left_axis,
                Vector3.up);

        if (wiper_right != null)
            wiper_right.localRotation = init_wiper_right_rot * Quaternion.AngleAxis(
                wiper_angle * wiper_axis * wiper_right_axis,
                Vector3.up);
    }

    // ── Window Animators ─────────────────────────────────────
    void InitializeWindows()
    {
        if (windows == null) return;

        for (int i = 0; i < windows.Length; i++)
        {
            WindowAnimatorEntry entry = windows[i];
            if (entry == null || string.IsNullOrWhiteSpace(entry.id)) continue;

            float initial = entry.startsOpen ? 0f : 1f;
            windowProgress[entry.id] = initial;
            ApplyWindowPose(entry, initial);
        }
    }

    void ApplyWindowPose(WindowAnimatorEntry entry, float normalized)
    {
        if (entry == null || entry.animator == null || string.IsNullOrWhiteSpace(entry.closeStateName)) return;

        entry.animator.Play(entry.closeStateName, 0, Mathf.Clamp01(normalized));
        entry.animator.Update(0f);
        entry.animator.speed = 0f;
    }

    WindowAnimatorEntry GetWindowEntry(string id)
    {
        if (windows == null || string.IsNullOrWhiteSpace(id)) return null;

        for (int i = 0; i < windows.Length; i++)
        {
            WindowAnimatorEntry entry = windows[i];
            if (entry != null && entry.id == id) return entry;
        }

        return null;
    }

    public void SetWindowState(string windowId, bool open)
    {
        WindowAnimatorEntry entry = GetWindowEntry(windowId);
        if (entry == null || entry.animator == null) return;

        float target = open ? 0f : 1f;

        if (!windowProgress.ContainsKey(windowId))
            windowProgress[windowId] = entry.startsOpen ? 0f : 1f;

        if (windowRoutines.TryGetValue(windowId, out Coroutine running) && running != null)
            StopCoroutine(running);

        windowRoutines[windowId] = StartCoroutine(AnimateWindowTo(entry, target));
    }

    IEnumerator AnimateWindowTo(WindowAnimatorEntry entry, float target)
    {
        string id = entry.id;
        if (!windowProgress.TryGetValue(id, out float current))
            current = entry.startsOpen ? 0f : 1f;

        while (!Mathf.Approximately(current, target))
        {
            current = Mathf.MoveTowards(current, target, Time.deltaTime * animation_speed);
            windowProgress[id] = current;
            ApplyWindowPose(entry, current);
            yield return null;
        }

        ApplyWindowPose(entry, target);
        windowRoutines[id] = null;
    }

    void HoldWindowTargets()
    {
        if (windows == null) return;

        for (int i = 0; i < windows.Length; i++)
        {
            WindowAnimatorEntry entry = windows[i];
            if (entry == null || entry.animator == null || string.IsNullOrWhiteSpace(entry.id))
                continue;

            if (windowRoutines.TryGetValue(entry.id, out Coroutine running) && running != null)
                continue;

            float target = IsWindowOpen(entry.id) ? 0f : 1f;
            windowProgress[entry.id] = target;
            ApplyWindowPose(entry, target);
        }
    }

    bool IsWindowOpen(string id)
    {
        switch (id)
        {
            case "fl": return window_fl_open;
            case "fr": return window_fr_open;
            case "rl": return window_rl_open;
            case "rr": return window_rr_open;
            default: return false;
        }
    }

    void SyncWindowsFromInspector()
    {
        if (window_fl_open != last_window_fl_open)
        {
            SetWindowState("fl", window_fl_open);
            last_window_fl_open = window_fl_open;
        }

        if (window_fr_open != last_window_fr_open)
        {
            SetWindowState("fr", window_fr_open);
            last_window_fr_open = window_fr_open;
        }

        if (window_rl_open != last_window_rl_open)
        {
            SetWindowState("rl", window_rl_open);
            last_window_rl_open = window_rl_open;
        }

        if (window_rr_open != last_window_rr_open)
        {
            SetWindowState("rr", window_rr_open);
            last_window_rr_open = window_rr_open;
        }
    }

    // ── Helpers ──────────────────────────────────────────────
    float GetAxis(Vector3 euler, string axis)
    {
        if (axis == "X") return euler.x;
        if (axis == "Y") return euler.y;
        return euler.z;
    }

    void SetAxis(Transform t, Vector3 initEuler,
                 float val, string axis)
    {
        if (axis == "X")
            t.localEulerAngles = new Vector3(
                initEuler.x + val, initEuler.y, initEuler.z);
        else if (axis == "Y")
            t.localEulerAngles = new Vector3(
                initEuler.x, initEuler.y + val, initEuler.z);
        else
            t.localEulerAngles = new Vector3(
                initEuler.x, initEuler.y, initEuler.z + val);
    }

    // ── Public methods for CANBridge ─────────────────────────
    public void SetDoorState(string door, bool open)
    {
        switch (door)
        {
            case "fl": door_fl_open = open; break;
            case "fr": door_fr_open = open; break;
            case "rl": door_rl_open = open; break;
            case "rr": door_rr_open = open; break;
        }
    }

    public void SetSteeringAngle(float angle)
    { steering_angle = angle; }
    public void SetWheelSpeed(float speed)
    { wheel_speed = speed; }
    public void SetHoodState(bool open)
    { hood_open = open; }
    public void SetTrunkState(bool open)
    { trunk_open = open; }
    public void SetWipers(bool on)
    { wipers_on = on; }
    public void SetWindowOpenState(string window, bool open)
    {
        SetWindowState(window, open);

        switch (window)
        {
            case "fl": window_fl_open = open; last_window_fl_open = open; break;
            case "fr": window_fr_open = open; last_window_fr_open = open; break;
            case "rl": window_rl_open = open; last_window_rl_open = open; break;
            case "rr": window_rr_open = open; last_window_rr_open = open; break;
        }
    }

    // Optional convenience methods
    public void SetFrontLeftWindow(bool open)
    { SetWindowOpenState("fl", open); }
    public void SetFrontRightWindow(bool open)
    { SetWindowOpenState("fr", open); }
    public void SetRearLeftWindow(bool open)
    { SetWindowOpenState("rl", open); }
    public void SetRearRightWindow(bool open)
    { SetWindowOpenState("rr", open); }
}