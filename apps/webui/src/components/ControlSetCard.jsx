import { useCallback, useEffect, useMemo, useState } from 'react';
import { DANGER_CONFIRM_TEXT, extractControlValue, formatControlValue } from '../controlSets.ts';

function normalizeCode(input) {
  const normalized = String(input ?? '')
    .replace(/^0x/i, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (!normalized) return '';
  return `0x${normalized.padStart(4, '0')}`;
}

function toTimeAgo(iso) {
  if (!iso) return 'never';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 'unknown';
  const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (deltaSec < 1) return 'just now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.round(deltaSec / 60);
  return `${min}m ago`;
}

function getInitialPending(control) {
  if (control.kind === 'slider') return control.min ?? 0;
  if (control.kind === 'toggle') return true;
  if (control.kind === 'select') return control.setVariantCodes?.[0]?.commandCode ?? '';
  return null;
}

function hasApply(control) {
  if (control.kind === 'button') return false;
  if (control.kind === 'select' || control.kind === 'toggle') return Array.isArray(control.setVariantCodes) && control.setVariantCodes.length > 0;
  return Boolean(control.setCode);
}

function pickSelectPending(control, extracted) {
  if (!Array.isArray(control.setVariantCodes) || control.setVariantCodes.length === 0) return '';
  const text = String(extracted ?? '').trim().toLowerCase();
  const byValue = control.setVariantCodes.find(option => String(option.value ?? '').trim().toLowerCase() === text);
  if (byValue) return byValue.commandCode;
  const byLabel = control.setVariantCodes.find(option => String(option.label ?? '').trim().toLowerCase() === text);
  if (byLabel) return byLabel.commandCode;

  const numeric = Number(extracted);
  if (Number.isFinite(numeric)) {
    const byNumeric = control.setVariantCodes.find(option => Number(option.value) === numeric);
    if (byNumeric) return byNumeric.commandCode;
  }

  return control.setVariantCodes[0].commandCode;
}

export default function ControlSetCard({ setDef, commandsByCode, runCommand, ip, refreshSignal, onToast }) {
  const initialRows = useMemo(() => {
    const rows = {};
    for (const control of setDef.controls) {
      rows[control.id] = {
        currentValue: null,
        pendingValue: getInitialPending(control),
        lastUpdated: null,
        state: 'idle',
        message: '',
        lastResult: null
      };
    }
    return rows;
  }, [setDef.controls]);

  const [rows, setRows] = useState(initialRows);
  const [dangerControlId, setDangerControlId] = useState('');
  const [dangerConfirmed, setDangerConfirmed] = useState(false);
  const [dangerText, setDangerText] = useState('');

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const updateRow = useCallback((controlId, updater) => {
    setRows(prev => ({
      ...prev,
      [controlId]: updater(prev[controlId] ?? {})
    }));
  }, []);

  const verifyControl = useCallback(
    async (control, { silent = false } = {}) => {
      updateRow(control.id, prev => ({
        ...prev,
        state: 'querying',
        message: 'querying...'
      }));

      try {
        const result = await runCommand({ commandCode: control.queryCode, targetIp: ip });
        const status = String(result.status ?? '').toUpperCase();
        const extracted = extractControlValue(control, result);

        updateRow(control.id, prev => {
          const next = {
            ...prev,
            currentValue: extracted,
            lastUpdated: new Date().toISOString(),
            state: status === 'NO_REPLY' ? 'no_reply' : 'synced',
            message: status === 'NO_REPLY' ? 'no reply' : 'synced',
            lastResult: result
          };

          if (control.kind === 'slider' && typeof extracted === 'number') {
            next.pendingValue = extracted;
          }

          if (control.kind === 'toggle' && typeof extracted === 'boolean') {
            next.pendingValue = extracted;
          }

          if (control.kind === 'select') {
            next.pendingValue = pickSelectPending(control, extracted);
          }

          return next;
        });

        if (!silent) onToast?.(`${control.label} verified`);
      } catch (error) {
        updateRow(control.id, prev => ({
          ...prev,
          state: 'error',
          message: String(error)
        }));
        if (!silent) onToast?.(`${control.label} verify failed`);
      }
    },
    [ip, onToast, runCommand, updateRow]
  );

  const applyControl = useCallback(
    async (control, { bypassDanger = false, silent = false } = {}) => {
      if (!hasApply(control)) return;
      if (control.dangerous && !bypassDanger) {
        setDangerControlId(control.id);
        setDangerConfirmed(false);
        setDangerText('');
        return;
      }

      const row = rows[control.id] ?? {};
      let commandCode = control.setCode;
      let value;

      if (control.kind === 'slider') {
        value = Number(row.pendingValue ?? control.min ?? 0);
        commandCode = control.setCode;
      }

      if (control.kind === 'select') {
        commandCode = String(row.pendingValue || control.setVariantCodes?.[0]?.commandCode || '');
      }

      if (control.kind === 'toggle') {
        const isOn = Boolean(row.pendingValue);
        const option = control.setVariantCodes?.find(item => String(item.value).toLowerCase() === (isOn ? 'wake' : 'sleep'));
        commandCode = option?.commandCode ?? control.setVariantCodes?.[0]?.commandCode;
      }

      if (!commandCode) return;

      updateRow(control.id, prev => ({
        ...prev,
        state: 'applying',
        message: 'applying...'
      }));

      try {
        const result = await runCommand({ commandCode, ...(typeof value === 'number' ? { value } : {}), targetIp: ip });
        const status = String(result.status ?? '').toUpperCase();
        updateRow(control.id, prev => ({
          ...prev,
          state: status === 'NO_REPLY' ? 'no_reply' : 'applied',
          message: status === 'NO_REPLY' ? 'no reply' : 'applied',
          lastUpdated: new Date().toISOString(),
          lastResult: result
        }));
        if (!silent) onToast?.(`${control.label} applied`);
      } catch (error) {
        updateRow(control.id, prev => ({
          ...prev,
          state: 'error',
          message: String(error)
        }));
        if (!silent) onToast?.(`${control.label} apply failed`);
      }
    },
    [ip, onToast, rows, runCommand, updateRow]
  );

  const verifyAll = useCallback(
    async ({ silent = false } = {}) => {
      for (const control of setDef.controls) {
        await verifyControl(control, { silent: true });
      }
      if (!silent) onToast?.(`${setDef.title}: verify all complete`);
    },
    [onToast, setDef.controls, setDef.title, verifyControl]
  );

  const applyAll = useCallback(
    async ({ silent = false } = {}) => {
      for (const control of setDef.controls) {
        if (!hasApply(control) || control.dangerous) continue;
        await applyControl(control, { silent: true, bypassDanger: true });
      }
      if (!silent) onToast?.(`${setDef.title}: apply all complete`);
    },
    [applyControl, onToast, setDef.controls, setDef.title]
  );

  useEffect(() => {
    if (!refreshSignal) return;
    verifyAll({ silent: true });
  }, [refreshSignal, verifyAll]);

  const canDangerConfirm = dangerConfirmed || dangerText.trim().toUpperCase() === DANGER_CONFIRM_TEXT;
  const dangerControl = setDef.controls.find(item => item.id === dangerControlId) ?? null;

  return (
    <article className="card controlSetCard">
      <div className="controlSetHead">
        <div>
          <h3>{setDef.title}</h3>
          <p>{setDef.description}</p>
        </div>
        <div className="controlSetActions">
          <button type="button" className="tinyButton" onClick={() => verifyAll()}>
            Verify all
          </button>
          <button type="button" className="tinyButton" onClick={() => applyAll()}>
            Apply all
          </button>
        </div>
      </div>

      <div className="controlRows">
        {setDef.controls.map(control => {
          const row = rows[control.id] ?? {};
          const currentText = formatControlValue(control, row.currentValue);
          const queryMeta = commandsByCode[normalizeCode(control.queryCode)];
          const stateText =
            row.state === 'idle'
              ? 'idle'
              : row.state === 'synced'
              ? `synced ${toTimeAgo(row.lastUpdated)}`
              : row.state === 'applied'
              ? `applied ${toTimeAgo(row.lastUpdated)}`
              : row.state === 'no_reply'
              ? 'no reply'
              : row.state === 'querying'
              ? 'querying...'
              : row.state === 'applying'
              ? 'applying...'
              : row.message || 'error';

          return (
            <div key={control.id} className="controlRowCompact">
              <div className="controlRowLabel">
                <strong>{control.label}</strong>
                <span className="valueBadge">{currentText}</span>
              </div>

              <div className="controlInputWrap">
                {control.kind === 'slider' ? (
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={Number(row.pendingValue ?? control.min ?? 0)}
                    onChange={event =>
                      updateRow(control.id, prev => ({
                        ...prev,
                        pendingValue: Number(event.target.value)
                      }))
                    }
                  />
                ) : null}

                {control.kind === 'select' ? (
                  <select
                    value={String(row.pendingValue ?? control.setVariantCodes?.[0]?.commandCode ?? '')}
                    onChange={event =>
                      updateRow(control.id, prev => ({
                        ...prev,
                        pendingValue: event.target.value
                      }))
                    }
                  >
                    {(control.setVariantCodes ?? []).map(option => (
                      <option key={option.commandCode} value={option.commandCode}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}

                {control.kind === 'toggle' ? (
                  <label className="miniToggle">
                    <input
                      type="checkbox"
                      checked={Boolean(row.pendingValue)}
                      onChange={event =>
                        updateRow(control.id, prev => ({
                          ...prev,
                          pendingValue: event.target.checked
                        }))
                      }
                    />
                    <span>{Boolean(row.pendingValue) ? control.onLabel : control.offLabel}</span>
                  </label>
                ) : null}
              </div>

              <div className="controlRowButtons">
                {hasApply(control) ? (
                  <button type="button" className="tinyButton" onClick={() => applyControl(control)}>
                    Apply
                  </button>
                ) : null}
                <button type="button" className="tinyButton" onClick={() => verifyControl(control)}>
                  Verify
                </button>
              </div>

              <div className="controlRowMeta" title={queryMeta ? `${queryMeta.commandCode} ${queryMeta.description || queryMeta.shortTitle || ''}` : control.queryCode}>
                {stateText}
              </div>
            </div>
          );
        })}
      </div>

      {dangerControl ? (
        <div className="dangerModal">
          <div className="dangerModalInner">
            <h4>Danger Zone Confirmation</h4>
            <p>
              {dangerControl.label} can affect device power state. Type <strong>{DANGER_CONFIRM_TEXT}</strong> or confirm with checkbox.
            </p>
            <input value={dangerText} onChange={event => setDangerText(event.target.value)} placeholder={`Type ${DANGER_CONFIRM_TEXT}`} />
            <label className="checkLine">
              <input type="checkbox" checked={dangerConfirmed} onChange={event => setDangerConfirmed(event.target.checked)} />
              I understand this can put the screen to sleep.
            </label>
            <div className="dangerActions">
              <button type="button" className="secondaryButton" onClick={() => setDangerControlId('')}>
                Cancel
              </button>
              <button
                type="button"
                className="primaryButton"
                disabled={!canDangerConfirm}
                onClick={async () => {
                  await applyControl(dangerControl, { bypassDanger: true });
                  setDangerControlId('');
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
