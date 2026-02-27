import { useCallback, useEffect, useMemo, useState } from 'react';
import { BASKETS, filterByBasket } from './commandGrouping.ts';
import { assertUiHintsInDev, extractHintValue, getUiHint } from './uiHints.ts';
import { buildStatusPanelContext, STATUS_PANELS } from './statusPanels.ts';
import { parseMeaningPairs } from './meaningFormat.ts';
import { CONTROL_SETS } from './controlSets.ts';
import { useControlAction } from './useControlAction.ts';
import ControlSetCard from './components/ControlSetCard.jsx';

const IP_STORAGE_KEY = 'exview.targetIp';
const COMMAND_STORAGE_KEY = 'exview.selectedCommand';
const FAVORITES_STORAGE_KEY = 'exview.favoriteCommands';

const TAB_DASHBOARD = 'dashboard';
const TAB_COMMAND = 'command';

const validationModeHelp = {
  STRICT_EXACT: 'Exact reply template comparison (checksum-aware).',
  PARSED_RANGE: 'Parse semantic value and validate expected range/meaning.',
  STRUCTURE_ONLY: 'Validate structural protocol fields only.',
  EXPECTED_NO_REPLY: 'No reply can be expected for this command policy.'
};

function normalizeCode(input) {
  const normalized = String(input ?? '')
    .replace(/^0x/i, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (!normalized) return '';
  return `0x${normalized.padStart(4, '0')}`;
}

function codeSortValue(input) {
  const normalized = normalizeCode(input);
  if (!normalized) return Number.MAX_SAFE_INTEGER;
  return parseInt(normalized.slice(2), 16);
}

function splitHex(hex) {
  if (!hex) return [];
  return String(hex)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function toCArray(parts) {
  if (parts.length === 0) return '';
  return `{${parts.map(item => `0x${item}`).join(', ')}}`;
}

function hexFormats(hex) {
  const parts = splitHex(hex);
  return {
    spaced: parts.join(' '),
    comma: parts.join(','),
    ox: parts.map(item => `0x${item}`).join(', '),
    cArray: toCArray(parts)
  };
}

function formatTime(iso) {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleTimeString();
}

function statusClass(status) {
  const text = String(status ?? '').toUpperCase();
  if (text === 'PASS') return 'badge badgePass';
  if (text === 'SKIPPED') return 'badge badgeSkipped';
  if (text === 'NO_REPLY') return 'badge badgeNoReply';
  return 'badge badgeFail';
}

function dotClass(status, loading, hasError) {
  if (loading) return 'dot dotLoading';
  if (hasError) return 'dot dotError';
  if (status === 'PASS' || status === 'SKIPPED') return 'dot dotOk';
  if (status === 'NO_REPLY') return 'dot dotWarn';
  return 'dot';
}

function knownNoReplyHint(result) {
  if (!result) return null;
  const status = String(result.status ?? '').toUpperCase();
  if (status !== 'NO_REPLY') return null;
  const code = normalizeCode(result.commandCode ?? result.raw?.setCode ?? result.raw?.command ?? '');
  const text = `${result.meaning ?? ''} ${result.note ?? ''} ${result.skipReason ?? ''}`.toLowerCase();
  if (code === '0xC211' || text.includes('split-screen') || text.includes('fw limitation')) {
    return 'Known limitation: split-screen firmware can return no reply for source query.';
  }
  return 'No reply from target within timeout. Check network path and device state.';
}

function createClientError(commandCode, error) {
  return {
    commandCode,
    status: 'FAIL',
    match: 'CLIENT_ERROR',
    validationMode: null,
    meaning: String(error),
    latencyMs: null,
    txHex: null,
    rxHex: null,
    parsed: null,
    raw: null,
    note: String(error)
  };
}

function buildInitialDashboardState() {
  const state = {};
  for (const panel of STATUS_PANELS) {
    state[panel.id] = {
      result: null,
      loading: false,
      error: '',
      lastStatus: '',
      updatedAt: null
    };
  }
  return state;
}

function safeParseFavorites(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch (_error) {
    return [];
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState(TAB_DASHBOARD);
  const [commands, setCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(true);
  const [commandsError, setCommandsError] = useState('');
  const [ip, setIp] = useState(() => localStorage.getItem(IP_STORAGE_KEY) || '192.168.0.20');
  const [search, setSearch] = useState('');
  const [selectedCode, setSelectedCode] = useState(() => localStorage.getItem(COMMAND_STORAGE_KEY) || '');
  const [selectedCommand, setSelectedCommand] = useState(null);
  const [favorites, setFavorites] = useState(() => safeParseFavorites(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]'));
  const [openSections, setOpenSections] = useState(() => Object.fromEntries(BASKETS.map(name => [name, true])));

  const [commandResult, setCommandResult] = useState(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [testingTarget, setTestingTarget] = useState(false);

  const [sliderValue, setSliderValue] = useState(50);
  const [selectSelector, setSelectSelector] = useState('');
  const [toggleOn, setToggleOn] = useState(true);
  const [currentValue, setCurrentValue] = useState(null);
  const [lastAppliedValue, setLastAppliedValue] = useState(null);

  const [dashboardState, setDashboardState] = useState(() => buildInitialDashboardState());
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(5);
  const [dashboardRefreshSignal, setDashboardRefreshSignal] = useState(0);

  const [toast, setToast] = useState('');

  const { runCommand } = useControlAction(ip);

  useEffect(() => {
    if (import.meta.env.DEV) {
      assertUiHintsInDev();
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(IP_STORAGE_KEY, ip);
  }, [ip]);

  useEffect(() => {
    if (selectedCode) localStorage.setItem(COMMAND_STORAGE_KEY, selectedCode);
  }, [selectedCode]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 1500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let disposed = false;
    async function loadCommands() {
      try {
        const res = await fetch('/api/commands');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load commands');
        if (disposed) return;

        const list = Array.isArray(data.commands) ? data.commands : [];
        list.sort((a, b) => codeSortValue(a.commandCode) - codeSortValue(b.commandCode));
        setCommands(list);
        setSelectedCode(current => {
          if (current && list.some(item => item.commandCode === current)) return current;
          return list[0]?.commandCode ?? '';
        });
      } catch (error) {
        if (!disposed) setCommandsError(String(error));
      } finally {
        if (!disposed) setCommandsLoading(false);
      }
    }

    loadCommands();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    async function loadCommandDetail() {
      if (!selectedCode) {
        setSelectedCommand(null);
        return;
      }
      try {
        const res = await fetch(`/api/command/${encodeURIComponent(selectedCode)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load command detail');
        if (!disposed) setSelectedCommand(data.command ?? null);
      } catch (error) {
        if (!disposed) setCommandsError(String(error));
      }
    }

    loadCommandDetail();
    return () => {
      disposed = true;
    };
  }, [selectedCode]);

  const selectedHint = useMemo(() => {
    if (!selectedCommand) return null;
    return getUiHint(selectedCommand.commandCode);
  }, [selectedCommand]);

  const searchedCommands = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = commands.filter(command => {
      if (!query) return true;
      const variantText = Array.isArray(command.variants) ? command.variants.map(item => item.label).join(' ') : '';
      const blob = `${command.commandCode} ${command.shortTitle ?? ''} ${command.category ?? ''} ${command.description ?? ''} ${variantText}`;
      return blob.toLowerCase().includes(query);
    });
    filtered.sort((a, b) => codeSortValue(a.commandCode) - codeSortValue(b.commandCode));
    return filtered;
  }, [commands, search]);

  const commandsByBasket = useMemo(() => {
    const grouped = {};
    for (const basket of BASKETS) {
      grouped[basket] = filterByBasket(searchedCommands, basket);
    }
    return grouped;
  }, [searchedCommands]);

  const favoriteCommands = useMemo(() => {
    const lookup = new Set(favorites);
    return commands
      .filter(command => lookup.has(command.commandCode))
      .sort((a, b) => codeSortValue(a.commandCode) - codeSortValue(b.commandCode));
  }, [commands, favorites]);

  const commandsByCode = useMemo(() => {
    const map = {};
    for (const command of commands) {
      map[normalizeCode(command.commandCode)] = command;
    }
    return map;
  }, [commands]);

  const meaningPairs = useMemo(() => parseMeaningPairs(commandResult?.meaning), [commandResult?.meaning]);

  const refreshDashboardPanel = useCallback(
    async panel => {
      setDashboardState(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id],
          loading: true,
          error: ''
        }
      }));

      try {
        const result = await runCommand({ commandCode: panel.commandCode, targetIp: ip });
        setDashboardState(prev => ({
          ...prev,
          [panel.id]: {
            result,
            loading: false,
            error: '',
            lastStatus: String(result.status ?? '').toUpperCase(),
            updatedAt: new Date().toISOString()
          }
        }));
      } catch (error) {
        setDashboardState(prev => ({
          ...prev,
          [panel.id]: {
            ...prev[panel.id],
            loading: false,
            error: String(error),
            lastStatus: 'ERROR',
            updatedAt: new Date().toISOString()
          }
        }));
      }
    },
    [ip, runCommand]
  );

  const refreshAllDashboard = useCallback(
    async ({ silent = false } = {}) => {
      if (!ip.trim()) {
        if (!silent) setToast('Set a target IP before refreshing.');
        return;
      }

      setRefreshingAll(true);
      await Promise.all(STATUS_PANELS.map(panel => refreshDashboardPanel(panel)));
      setRefreshingAll(false);
      setDashboardRefreshSignal(value => value + 1);
      if (!silent) setToast('Status refreshed');
    },
    [ip, refreshDashboardPanel]
  );

  const runVerify = useCallback(async () => {
    if (!selectedHint?.queryPair || !selectedCommand) return;

    setVerifying(true);
    try {
      const result = await runCommand({ commandCode: selectedHint.queryPair, targetIp: ip });
      setCommandResult(result);

      const extracted = extractHintValue(selectedHint, result);
      if (typeof extracted === 'number') {
        setCurrentValue(extracted);
      } else if (typeof extracted === 'boolean') {
        setCurrentValue(extracted ? 1 : 0);
      } else {
        setCurrentValue(null);
      }

      setToast('Verify complete');
    } catch (error) {
      setCommandResult(createClientError(selectedHint.queryPair, error));
      setToast('Verify failed');
    } finally {
      setVerifying(false);
    }
  }, [ip, runCommand, selectedCommand, selectedHint]);

  useEffect(() => {
    if (activeTab !== TAB_DASHBOARD) return;
    refreshAllDashboard({ silent: true });
  }, [activeTab, refreshAllDashboard]);

  useEffect(() => {
    if (activeTab !== TAB_DASHBOARD || !autoRefreshEnabled) return;
    const timer = setInterval(() => {
      refreshAllDashboard({ silent: true });
    }, autoRefreshSeconds * 1000);

    return () => clearInterval(timer);
  }, [activeTab, autoRefreshEnabled, autoRefreshSeconds, refreshAllDashboard]);

  useEffect(() => {
    if (!selectedCommand) return;
    const hint = selectedHint;

    setCurrentValue(null);
    setLastAppliedValue(null);

    if (!hint) {
      setSelectSelector(selectedCommand.defaultSelector ?? selectedCommand.commandCode);
      return;
    }

    if (hint.type === 'slider') {
      setSliderValue(hint.defaultValue);
    }

    if (hint.type === 'toggle') {
      setToggleOn(Boolean(hint.defaultOn));
    }

    if (hint.type === 'select') {
      const first = selectedCommand.variants?.[0]?.selector ?? selectedCommand.defaultSelector ?? selectedCommand.commandCode;
      setSelectSelector(first);
    }

    if (hint.queryPair) {
      runVerify();
    }
  }, [runVerify, selectedCommand, selectedHint]);

  const tx = hexFormats(commandResult?.txHex);
  const rx = hexFormats(commandResult?.rxHex);
  const noReplyInfo = knownNoReplyHint(commandResult);

  const currentValueText = useMemo(() => {
    if (!selectedHint) return null;

    if (selectedHint.type === 'slider') {
      if (verifying) return 'Current value: querying...';
      if (typeof currentValue === 'number') return `Current value: ${currentValue}${selectedHint.units ? ` ${selectedHint.units}` : ''}`;
      if (typeof lastAppliedValue === 'number') return `Last applied: ${lastAppliedValue}${selectedHint.units ? ` ${selectedHint.units}` : ''}`;
      return 'Current value: unknown';
    }

    if (selectedHint.type === 'toggle') {
      if (verifying) return 'Current value: querying...';
      if (typeof currentValue === 'number') return `Current value: ${currentValue ? selectedHint.onLabel : selectedHint.offLabel}`;
      return `Last applied: ${toggleOn ? selectedHint.onLabel : selectedHint.offLabel}`;
    }

    if (selectedHint.type === 'select') {
      return verifying ? 'Current source: querying...' : 'Use Verify to read current source.';
    }

    return null;
  }, [currentValue, lastAppliedValue, selectedHint, toggleOn, verifying]);

  function toggleFavorite(commandCode) {
    setFavorites(prev => {
      if (prev.includes(commandCode)) return prev.filter(item => item !== commandCode);
      return [...prev, commandCode];
    });
  }

  function toggleSection(name) {
    setOpenSections(prev => ({
      ...prev,
      [name]: !prev[name]
    }));
  }

  async function copyText(text, label) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setToast(`${label} copied`);
  }

  async function onTestTarget() {
    if (!ip.trim()) {
      setToast('Set a target IP first.');
      return;
    }

    setTestingTarget(true);
    try {
      const result = await runCommand({ commandCode: '0xC005', targetIp: ip });
      const status = String(result.status ?? '').toUpperCase();
      if (status === 'PASS' || status === 'SKIPPED') {
        setToast(`Target check: ${status}`);
      } else if (status === 'NO_REPLY') {
        setToast('Target check: NO_REPLY');
      } else {
        setToast(`Target check: ${status || 'Unknown'}`);
      }
    } catch (error) {
      setToast(`Target check failed: ${String(error)}`);
    } finally {
      setTestingTarget(false);
    }
  }

  async function onSendPrimary() {
    if (!selectedCommand) return;

    const hint = selectedHint;
    let commandCode = selectedCommand.defaultSelector ?? selectedCommand.commandCode;
    let value;

    if (hint?.type === 'slider') {
      commandCode = selectedCommand.commandCode;
      value = Math.round(sliderValue);
    }

    if (hint?.type === 'toggle') {
      commandCode = toggleOn ? hint.onSelector : hint.offSelector;
    }

    if (hint?.type === 'select') {
      commandCode = selectSelector || selectedCommand.defaultSelector || selectedCommand.commandCode;
    }

    if (hint?.type === 'button') {
      commandCode = hint.queryPair || selectedCommand.commandCode;
    }

    setSending(true);
    try {
      const result = await runCommand({ commandCode, ...(typeof value === 'number' ? { value } : {}), targetIp: ip });
      setCommandResult(result);

      if (typeof value === 'number') {
        setLastAppliedValue(value);
      }

      const extracted = hint ? extractHintValue(hint, result) : null;
      if (typeof extracted === 'number') {
        setCurrentValue(extracted);
      } else if (typeof extracted === 'boolean') {
        setCurrentValue(extracted ? 1 : 0);
      }

      setToast('Command sent');
    } catch (error) {
      setCommandResult(createClientError(commandCode, error));
      setToast('Command failed');
    } finally {
      setSending(false);
    }
  }

  const commandActionLabel = selectedHint?.type === 'slider' ? 'Apply' : selectedHint?.type === 'button' ? selectedHint.buttonText || 'Send' : 'Send';

  return (
    <div className="appShell">
      <header className="topBar">
        <div>
          <h1>eXview AIO Protocol Tool</h1>
          <p>Fast status visibility first, command forcing second.</p>
        </div>

        <nav className="tabNav" aria-label="Main navigation">
          <button type="button" className={`tabButton ${activeTab === TAB_DASHBOARD ? 'active' : ''}`} onClick={() => setActiveTab(TAB_DASHBOARD)}>
            Status Dashboard
          </button>
          <button type="button" className={`tabButton ${activeTab === TAB_COMMAND ? 'active' : ''}`} onClick={() => setActiveTab(TAB_COMMAND)}>
            Command Center
          </button>
        </nav>
      </header>

      {activeTab === TAB_DASHBOARD ? (
        <main className="page dashboardPage">
          <section className="card toolbarCard">
            <div className="toolbarGrid">
              <label className="field">
                Target IP
                <input value={ip} onChange={event => setIp(event.target.value)} placeholder="192.168.0.20" />
              </label>

              <div className="toolbarActions">
                <button type="button" className="secondaryButton" onClick={onTestTarget} disabled={testingTarget}>
                  {testingTarget ? 'Testing...' : 'Test target'}
                </button>
                <button type="button" className="primaryButton" onClick={() => refreshAllDashboard()} disabled={refreshingAll}>
                  {refreshingAll ? 'Refreshing...' : 'Refresh all'}
                </button>
              </div>
            </div>

            <div className="autoRow">
              <label className="checkLine">
                <input type="checkbox" checked={autoRefreshEnabled} onChange={event => setAutoRefreshEnabled(event.target.checked)} />
                Auto-refresh
              </label>

              <label className="intervalField">
                Interval
                <select
                  value={autoRefreshSeconds}
                  onChange={event => setAutoRefreshSeconds(Number(event.target.value))}
                  disabled={!autoRefreshEnabled}
                >
                  <option value={2}>2s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                </select>
              </label>
            </div>
          </section>

          <section className="statusGrid">
            {STATUS_PANELS.map(panel => {
              const state = dashboardState[panel.id] ?? { loading: false, error: '', lastStatus: '', result: null, updatedAt: null };
              const context = buildStatusPanelContext(state.result);
              const primary = panel.getPrimary(context);
              const secondary = panel.getSecondary ? panel.getSecondary(context) : null;
              const meter = panel.getMeter ? panel.getMeter(context) : null;
              const indicators = panel.getIndicators ? panel.getIndicators(context) : null;

              return (
                <article key={panel.id} className="card statusCard">
                  <div className="statusCardHead">
                    <h3>{panel.title}</h3>
                    <span className={dotClass(state.lastStatus, state.loading, Boolean(state.error))} aria-hidden="true" />
                  </div>

                  <p className="statusValue">{primary || '-'}</p>
                  {secondary ? <p className="statusSub">{secondary}</p> : null}

                  {typeof meter === 'number' ? (
                    <div className="meterWrap" aria-label={`${panel.title} meter`}>
                      <div className="meterFill" style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
                    </div>
                  ) : null}

                  {Array.isArray(indicators) && indicators.length > 0 ? (
                    <div className="indicatorRow">
                      {indicators.map(item => (
                        <span key={item.label} className={`indicator ${item.active ? 'active' : 'inactive'}`}>
                          {item.label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <p className="statusMeta statusCaption" title={panel.description}>
                    {panel.commandCode}
                  </p>
                  <p className="statusMeta">Last updated: {formatTime(state.updatedAt)}</p>

                  {state.lastStatus === 'NO_REPLY' ? <p className="statusHint">No reply at this moment.</p> : null}
                  {state.error ? <p className="statusHint">{state.error}</p> : null}
                </article>
              );
            })}
          </section>

          <section className="controlSetsGrid">
            {CONTROL_SETS.map(setDef => (
              <ControlSetCard
                key={setDef.id}
                setDef={setDef}
                commandsByCode={commandsByCode}
                runCommand={runCommand}
                ip={ip}
                refreshSignal={dashboardRefreshSignal}
                onToast={setToast}
              />
            ))}
          </section>
        </main>
      ) : (
        <main className="page commandPage">
          <aside className="card navCard">
            <label className="field">
              Search commands
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Code, title, category..." />
            </label>

            <section className="favoritesBlock">
              <div className="sectionHead">
                <h3>Favorites</h3>
                <span>{favoriteCommands.length}</span>
              </div>
              {favoriteCommands.length === 0 ? <p className="emptyText">Star commands for quick access.</p> : null}
              <div className="commandList">
                {favoriteCommands.map(command => (
                  <div key={`fav-${command.commandCode}`} className={`commandRow ${selectedCode === command.commandCode ? 'active' : ''}`}>
                    <button type="button" className="commandSelect" onClick={() => setSelectedCode(command.commandCode)}>
                      <code>{command.commandCode}</code>
                      <strong>{command.shortTitle}</strong>
                      <span>{command.description || command.defaultVariant || '-'}</span>
                    </button>
                    <button
                      type="button"
                      className={`starButton ${favorites.includes(command.commandCode) ? 'on' : ''}`}
                      onClick={() => toggleFavorite(command.commandCode)}
                    >
                      *
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <div className="accordionList">
              {BASKETS.map(section => {
                const items = commandsByBasket[section] ?? [];
                const open = Boolean(openSections[section]);

                return (
                  <section key={section} className="accordionSection">
                    <button type="button" className="accordionHeader" onClick={() => toggleSection(section)}>
                      <span>{section}</span>
                      <span>
                        {items.length} {open ? '-' : '+'}
                      </span>
                    </button>

                    {open ? (
                      <div className="commandList">
                        {items.length === 0 ? <p className="emptyText">No commands match this filter.</p> : null}
                        {items.map(command => (
                          <div key={command.commandCode} className={`commandRow ${selectedCode === command.commandCode ? 'active' : ''}`}>
                            <button type="button" className="commandSelect" onClick={() => setSelectedCode(command.commandCode)}>
                              <code>{command.commandCode}</code>
                              <strong>{command.shortTitle}</strong>
                              <span>{command.description || command.defaultVariant || '-'}</span>
                            </button>
                            <button
                              type="button"
                              className={`starButton ${favorites.includes(command.commandCode) ? 'on' : ''}`}
                              onClick={() => toggleFavorite(command.commandCode)}
                            >
                              *
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </aside>

          <section className="commandMain">
            <article className="card commandCard">
              {!selectedCommand ? (
                <div className="emptyState">
                  <h2>Select a command</h2>
                  <p>Pick a command from Favorites or a basket to start.</p>
                </div>
              ) : (
                <>
                  <div className="commandHeader">
                    <div>
                      <h2>{selectedCommand.title || selectedCommand.commandCode}</h2>
                      <p>{selectedCommand.description || 'No description available.'}</p>
                    </div>
                    <div className="badgeRow">
                      <span className="tinyBadge">Reply {selectedCommand.replyCode || '-'}</span>
                      <span className="tinyBadge" title={validationModeHelp[selectedCommand.validationMode] || 'Validation mode from backend truth.'}>
                        {selectedCommand.validationMode || 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div className="targetRow">
                    <label className="field">
                      Target IP
                      <input value={ip} onChange={event => setIp(event.target.value)} placeholder="192.168.0.20" />
                    </label>
                    <button type="button" className="secondaryButton" onClick={onTestTarget} disabled={testingTarget}>
                      {testingTarget ? 'Testing...' : 'Test target'}
                    </button>
                  </div>

                  <div className="controlCard">
                    {selectedHint?.type === 'slider' ? (
                      <label className="field">
                        {selectedHint.label}: {sliderValue}
                        <input
                          type="range"
                          min={selectedHint.min}
                          max={selectedHint.max}
                          step={selectedHint.step}
                          value={sliderValue}
                          onChange={event => setSliderValue(Number(event.target.value))}
                        />
                      </label>
                    ) : null}

                    {selectedHint?.type === 'toggle' ? (
                      <div className="toggleWrap">
                        <span>{selectedHint.label}</span>
                        <button type="button" className={`toggleButton ${toggleOn ? 'on' : 'off'}`} onClick={() => setToggleOn(value => !value)}>
                          {toggleOn ? selectedHint.onLabel : selectedHint.offLabel}
                        </button>
                      </div>
                    ) : null}

                    {selectedHint?.type === 'select' ? (
                      <label className="field">
                        {selectedHint.label}
                        <select value={selectSelector} onChange={event => setSelectSelector(event.target.value)}>
                          {(selectedCommand.variants ?? []).map(variant => (
                            <option key={variant.selector} value={variant.selector}>
                              {variant.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {currentValueText ? <p className="helperText">{currentValueText}</p> : null}
                    {!selectedHint ? <p className="helperText">No UI hint for this command. It will send as selected.</p> : null}

                    {selectedCommand.excludedInSuite ? <p className="helperText">Excluded in suite: {selectedCommand.exclusionReason}</p> : null}

                    <div className="actionRow">
                      <button type="button" className="primaryButton" onClick={onSendPrimary} disabled={sending || commandsLoading}>
                        {sending ? 'Sending...' : commandActionLabel}
                      </button>
                      {selectedHint?.queryPair ? (
                        <button type="button" className="secondaryButton" onClick={runVerify} disabled={verifying || sending}>
                          {verifying ? 'Verifying...' : 'Verify'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </article>

            <article className="card responseCard">
              <div className="responseHead">
                <h3>Response</h3>
                {commandResult?.status ? <span className={statusClass(commandResult.status)}>{commandResult.status}</span> : null}
              </div>

              {!commandResult ? (
                <p className="emptyText">Send a command to see status, meaning, and payloads.</p>
              ) : (
                <>
                  <div className="meaningBlock">
                    <p className="meaningTitle">Meaning</p>
                    {meaningPairs.length > 0 ? (
                      <div className="chipWrap">
                        {meaningPairs.map(item => (
                          <span key={`${item.key}-${item.value}`} className="pairChip">
                            <strong>{item.label}</strong>
                            <span>{item.value}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="meaningText">{commandResult.meaning || '-'}</p>
                    )}
                  </div>

                  <div className="metaInline">
                    <span>Match: {commandResult.match || '-'}</span>
                    <span>Latency: {commandResult.latencyMs == null ? '-' : `${commandResult.latencyMs} ms`}</span>
                  </div>

                  {noReplyInfo ? <p className="statusHint">{noReplyInfo}</p> : null}

                  <details className="rawBlock">
                    <summary>Show raw TX/RX</summary>

                    <h4>TX Hex</h4>
                    <pre>{tx.spaced || '-'}</pre>
                    <div className="copyRow">
                      <button type="button" onClick={() => copyText(tx.spaced, 'TX spaced')} disabled={!tx.spaced}>
                        Spaced
                      </button>
                      <button type="button" onClick={() => copyText(tx.comma, 'TX comma')} disabled={!tx.comma}>
                        Comma
                      </button>
                      <button type="button" onClick={() => copyText(tx.ox, 'TX 0x')} disabled={!tx.ox}>
                        0x
                      </button>
                      <button type="button" onClick={() => copyText(tx.cArray, 'TX C array')} disabled={!tx.cArray}>
                        C Array
                      </button>
                    </div>

                    <h4>RX Hex</h4>
                    <pre>{rx.spaced || '-'}</pre>
                    <div className="copyRow">
                      <button type="button" onClick={() => copyText(rx.spaced, 'RX spaced')} disabled={!rx.spaced}>
                        Spaced
                      </button>
                      <button type="button" onClick={() => copyText(rx.comma, 'RX comma')} disabled={!rx.comma}>
                        Comma
                      </button>
                      <button type="button" onClick={() => copyText(rx.ox, 'RX 0x')} disabled={!rx.ox}>
                        0x
                      </button>
                      <button type="button" onClick={() => copyText(rx.cArray, 'RX C array')} disabled={!rx.cArray}>
                        C Array
                      </button>
                    </div>
                  </details>

                  <details className="advancedBlock">
                    <summary>Advanced (backend debug)</summary>
                    <h4>Parsed JSON</h4>
                    <pre>{JSON.stringify(commandResult.parsed, null, 2)}</pre>
                    <h4>Raw Response</h4>
                    <pre>{JSON.stringify(commandResult.raw, null, 2)}</pre>
                  </details>
                </>
              )}
            </article>

            {commandsError ? <pre className="errorBox">{commandsError}</pre> : null}
          </section>
        </main>
      )}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
