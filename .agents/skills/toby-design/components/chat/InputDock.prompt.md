The composer. It floats over the transcript on the content background with a 16px radius and the only large shadow in the app. Attach sits on the left of the control row; Send is a larger circular control on the right. Empty-field placeholder restates Return / Shift-Return.

```jsx
<InputDock value={draft} contextPercent={42} onChange={setDraft} onSubmit={send} />
```

The Send button uses the user accent once there is something to send; disabled it is a neutral selection wash. Enabled attach, cancel, and send show a pointing-hand cursor and a quiet hover wash.
