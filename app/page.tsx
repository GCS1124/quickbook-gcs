'use client';

import { useMemo, useState } from 'react';

type NavItem = { label: string; icon: string };
type Activity = { name: string; detail: string; amount: string; status: string; tone: string };

const navItems: NavItem[] = [
  { label: 'Overview', icon: '◈' },
  { label: 'Sales', icon: '↗' },
  { label: 'Expenses', icon: '↘' },
  { label: 'Customers', icon: '◉' },
  { label: 'Reports', icon: '▥' },
];

const activity: Activity[] = [
  { name: 'Nexus Creative Co.', detail: 'Invoice #1048 · Today', amount: '$3,420.00', status: 'Paid', tone: 'paid' },
  { name: 'Brightline Studio', detail: 'Invoice #1047 · Yesterday', amount: '$1,875.00', status: 'Pending', tone: 'pending' },
  { name: 'Notion Labs', detail: 'Expense · Aug 20, 2026', amount: '$96.00', status: 'Review', tone: 'review' },
  { name: 'Mosaic Ventures', detail: 'Invoice #1046 · Aug 18, 2026', amount: '$2,250.00', status: 'Paid', tone: 'paid' },
];

const chartData = [
  { month: 'Mar', income: 58, expense: 30 },
  { month: 'Apr', income: 72, expense: 45 },
  { month: 'May', income: 54, expense: 28 },
  { month: 'Jun', income: 84, expense: 41 },
  { month: 'Jul', income: 76, expense: 36 },
  { month: 'Aug', income: 96, expense: 48 },
];

const transactionActions = [
  { label: 'Create invoice', note: 'Send a new invoice to a customer', icon: '↗' },
  { label: 'Record expense', note: 'Add a bill, receipt, or purchase', icon: '↘' },
  { label: 'Add customer', note: 'Save a new customer profile', icon: '◉' },
];

export default function Home() {
  const [activeNav, setActiveNav] = useState('Overview');
  const [showNew, setShowNew] = useState(false);
  const [period, setPeriod] = useState('This month');
  const [range, setRange] = useState('6M');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');

  const filteredActivity = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return activity;
    return activity.filter((item) => `${item.name} ${item.detail} ${item.status}`.toLowerCase().includes(normalized));
  }, [query]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }

  function handleNav(label: string) {
    setActiveNav(label);
    if (label !== 'Overview') showToast(`${label} is ready for your next review.`);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>G</span></div>
          <div>
            <div className="brand-name">GCS Books</div>
            <div className="brand-subtitle">Global Creative Services</div>
          </div>
        </div>

        <button className="company-switcher" onClick={() => showToast('Company switcher opened.') }>
          <span className="company-avatar">GC</span>
          <span className="company-copy"><strong>GCS Tech &amp; Media LLC</strong><small>Business account</small></span>
          <span className="chevron">⌄</span>
        </button>

        <div className="nav-section-label">Workspace</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.label}
              className={`nav-item ${activeNav === item.label ? 'is-active' : ''}`}
              onClick={() => handleNav(item.label)}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.label === 'Overview' && <span className="active-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>

        <div className="nav-section-label tools-label">Tools</div>
        <nav className="primary-nav" aria-label="Tools navigation">
          <button className="nav-item" onClick={() => showToast('Tax center is opening soon.')}><span className="nav-icon">%</span><span>Tax center</span></button>
          <button className="nav-item" onClick={() => showToast('Payroll workspace is opening soon.')}><span className="nav-icon">▤</span><span>Payroll</span><span className="new-badge">NEW</span></button>
        </nav>

        <div className="sidebar-footer">
          <div className="support-card">
            <span className="support-icon">✦</span>
            <div><strong>Need a hand?</strong><small>Talk to a GCS advisor</small></div>
            <button aria-label="Open advisor chat" onClick={() => showToast('An advisor will be with you shortly.')}>↗</button>
          </div>
          <div className="user-row">
            <span className="user-avatar">SM</span>
            <div><strong>Shadma Mittal</strong><small>Owner · Admin</small></div>
            <button aria-label="Open profile menu" onClick={() => showToast('Profile menu opened.')}>•••</button>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" aria-label="Open navigation" onClick={() => showToast('Use the desktop view to access workspace navigation.')}>☰</button>
            <div className="breadcrumbs"><span>Workspace</span><span className="crumb-separator">/</span><strong>{activeNav}</strong></div>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input aria-label="Search your books" placeholder="Search your books" value={query} onChange={(event) => setQuery(event.target.value)} />
              <kbd>⌘ K</kbd>
            </label>
            <button className="icon-button" aria-label="View notifications" onClick={() => showToast('You are all caught up.')}>♢<span className="notification-dot" /></button>
            <button className="help-link" onClick={() => showToast('GCS support is here to help.')}>Help</button>
            <span className="top-avatar">SM</span>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow">Tuesday, August 24, 2026</div>
              <h1>Good morning, Shadma <span className="wave">✦</span></h1>
              <p>Here&apos;s how your business is doing.</p>
            </div>
            <div className="heading-actions">
              <label className="period-select">
                <span className="sr-only">Date range</span>
                <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                  <option>This month</option>
                  <option>Last month</option>
                  <option>This quarter</option>
                  <option>This year</option>
                </select>
                <span>⌄</span>
              </label>
              <button className="new-button" onClick={() => setShowNew(true)}><span>+</span> New</button>
            </div>
          </div>

          <div className="insight-banner">
            <div className="insight-icon">✦</div>
            <div className="insight-copy"><strong>Your business is on a strong start.</strong><span>Cash in is up 18.4% compared with last month. Keep the momentum going.</span></div>
            <button onClick={() => showToast('Opening your cash flow report.')}>View report <span>↗</span></button>
          </div>

          <section className="metric-grid" aria-label="Business metrics">
            <MetricCard label="Total income" value="$48,220.00" change="18.4%" note="vs. last month" tone="green" icon="↗" />
            <MetricCard label="Total expenses" value="$16,745.50" change="6.2%" note="vs. last month" tone="blue" icon="↘" />
            <MetricCard label="Net income" value="$31,474.50" change="24.8%" note="vs. last month" tone="violet" icon="∿" />
            <MetricCard label="Invoices pending" value="$8,640.00" change="3 open" note="needs your attention" tone="orange" icon="◷" />
          </section>

          <div className="dashboard-grid">
            <section className="panel cashflow-panel">
              <div className="panel-heading">
                <div><div className="eyebrow">Performance</div><h2>Cash flow</h2><p>Money in and money out over time</p></div>
                <div className="range-tabs" role="tablist" aria-label="Cash flow range">
                  {['6M', '1Y'].map((tab) => <button key={tab} className={range === tab ? 'selected' : ''} onClick={() => setRange(tab)}>{tab}</button>)}
                </div>
              </div>
              <div className="chart-legend"><span><i className="legend-dot income" /> Income</span><span><i className="legend-dot expense" /> Expenses</span><strong>Aug 2026 <em>↑ 18.4%</em></strong></div>
              <div className="chart-area">
                <div className="y-axis"><span>$50k</span><span>$35k</span><span>$20k</span><span>$5k</span></div>
                <div className="bar-chart" aria-label="Bar chart of income and expenses">
                  {[1, 2, 3, 4].map((line) => <span key={line} className="grid-line" style={{ bottom: `${line * 25}%` }} />)}
                  {chartData.map((bar) => <div className="bar-group" key={bar.month}><div className="bars"><span className="bar income-bar" style={{ height: `${bar.income}%` }} /><span className="bar expense-bar" style={{ height: `${bar.expense}%` }} /></div><small>{bar.month}</small></div>)}
                </div>
              </div>
            </section>

            <section className="panel tasks-panel">
              <div className="panel-heading compact"><div><div className="eyebrow">To-do list</div><h2>Tasks to review</h2></div><button className="text-button" onClick={() => showToast('All tasks are in view.')}>View all <span>↗</span></button></div>
              <div className="task-progress"><div className="progress-ring"><span>3<small>/ 5</small></span></div><div><strong>You&apos;re almost there</strong><p>Two more items to keep your books tidy.</p></div></div>
              <div className="task-list">
                <TaskRow color="orange" title="Review 3 expenses" note="Due today" onClick={() => showToast('Expense review opened.')} />
                <TaskRow color="purple" title="Send 2 invoices" note="$4,125.00 outstanding" onClick={() => showToast('Invoice center opened.')} />
                <TaskRow color="green" title="Reconcile bank feed" note="Last synced 2h ago" onClick={() => showToast('Bank feed is up to date.')} done />
              </div>
            </section>
          </div>

          <div className="bottom-grid">
            <section className="panel activity-panel">
              <div className="panel-heading compact"><div><div className="eyebrow">Latest updates</div><h2>Recent activity</h2></div><button className="text-button" onClick={() => showToast('Showing all activity.')}>See all <span>↗</span></button></div>
              <div className="activity-table">
                <div className="activity-header"><span>Activity</span><span>Amount</span><span>Status</span><span /></div>
                {filteredActivity.length ? filteredActivity.map((item) => <ActivityRow item={item} key={item.name} onClick={() => showToast(`${item.name} details opened.`)} />) : <div className="empty-state">No activity matches “{query}”.</div>}
              </div>
            </section>

            <section className="panel money-panel">
              <div className="panel-heading compact"><div><div className="eyebrow">Accounts receivable</div><h2>Money in</h2></div><button className="circle-arrow" aria-label="Open money in" onClick={() => showToast('Accounts receivable opened.')}>↗</button></div>
              <div className="money-total"><strong>$8,640.00</strong><span>expected from open invoices</span></div>
              <div className="money-progress"><span style={{ width: '67%' }} /></div>
              <div className="money-breakdown"><div><span className="break-dot paid-dot" />Paid this month <strong>$12,420</strong></div><div><span className="break-dot due-dot" />Due within 30 days <strong>$8,640</strong></div></div>
            </section>
          </div>

          <footer className="page-footer"><span>GCS Books · Built for the people behind the business.</span><span><button onClick={() => showToast('Privacy policy opened.')}>Privacy</button><button onClick={() => showToast('Terms opened.')}>Terms</button><span>© 2026 GCS</span></span></footer>
        </div>
      </section>

      {showNew && <div className="modal-backdrop" role="presentation" onClick={() => setShowNew(false)}><div className="new-modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">Quick action</div><h2 id="new-title">What would you like to add?</h2></div><button className="modal-close" aria-label="Close dialog" onClick={() => setShowNew(false)}>×</button></div><div className="action-list">{transactionActions.map((action) => <button key={action.label} className="action-row" onClick={() => { setShowNew(false); showToast(`${action.label} started.`); }}><span className="action-icon">{action.icon}</span><span><strong>{action.label}</strong><small>{action.note}</small></span><span className="action-arrow">↗</span></button>)}</div><div className="modal-note"><span>✦</span> GCS Books keeps your next step simple.</div></div></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function MetricCard({ label, value, change, note, tone, icon }: { label: string; value: string; change: string; note: string; tone: string; icon: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-label">{label}</div><strong className="metric-value">{value}</strong><div className="metric-change"><span className={tone === 'orange' ? 'neutral-change' : 'positive-change'}>{tone === 'orange' ? '•' : '↑'} {change}</span><span>{note}</span></div></article>;
}

function TaskRow({ color, title, note, onClick, done }: { color: string; title: string; note: string; onClick: () => void; done?: boolean }) {
  return <button className={`task-row ${done ? 'is-done' : ''}`} onClick={onClick}><span className={`task-check ${color}`}>{done ? '✓' : ''}</span><span><strong>{title}</strong><small>{note}</small></span><span className="row-arrow">↗</span></button>;
}

function ActivityRow({ item, onClick }: { item: Activity; onClick: () => void }) {
  return <button className="activity-row" onClick={onClick}><span className="activity-main"><span className={`activity-avatar ${item.tone}`}>{item.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span></span><strong className="activity-amount">{item.amount}</strong><span className={`status-pill ${item.tone}`}>{item.status}</span><span className="row-arrow">↗</span></button>;
}
