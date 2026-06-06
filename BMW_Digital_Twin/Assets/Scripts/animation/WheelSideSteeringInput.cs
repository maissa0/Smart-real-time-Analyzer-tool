using UnityEngine;

public class WheelSideSteeringInput : MonoBehaviour
{
    [Header("Steering wheels (Y rotation animators)")]
    [SerializeField] private GameObjectAnimator[] steeringAnimators;

    [Header("Steering settings")]
    [SerializeField] private string horizontalAxis = "Horizontal";
    [SerializeField] private float steerSpeed = 1.5f;
    [SerializeField] private float steerReturnSpeed = 2f;
    [SerializeField, Range(0f, 1f)] private float centerPreview = 0.5f;

    private void Update()
    {
        float steerInput = Input.GetAxis(horizontalAxis);

        if (!Mathf.Approximately(steerInput, 0f))
        {
            float delta = steerInput * steerSpeed * Time.deltaTime;
            ApplyDelta(delta);
            return;
        }

        ReturnToCenter();
    }

    private void ApplyDelta(float delta)
    {
        if (steeringAnimators == null)
        {
            return;
        }

        for (int i = 0; i < steeringAnimators.Length; i++)
        {
            if (steeringAnimators[i] == null)
            {
                continue;
            }

            steeringAnimators[i].AddPreviewDelta(delta);
        }
    }

    private void ReturnToCenter()
    {
        if (steeringAnimators == null)
        {
            return;
        }

        float step = steerReturnSpeed * Time.deltaTime;

        for (int i = 0; i < steeringAnimators.Length; i++)
        {
            if (steeringAnimators[i] == null)
            {
                continue;
            }

            float current = steeringAnimators[i].GetPreview();
            float next = Mathf.MoveTowards(current, centerPreview, step);
            steeringAnimators[i].SetPreview(next);
        }
    }
}
