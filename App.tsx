import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Business, HistoryRow, OPGS, Owner, TOTAL, colorOf, configured, opgName, supabase } from './lib'

type Filter = 'all' | 'free' | Exclude<Owner, null>
type Part = { label: string; value: number; color: string }

const pct = (n: number) => ((n / TOTAL) * 100).toFixed(1)
const fmt = (d: string | number) => new Date(d).toLocaleString('ru-RU')

function Num({ v }: { v: number }) {
  const [n, setN] = useState(v)
  useEffect(() => {
    const from = n
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min((t - t0) / 600, 1)
      setN(Math.round(from + (v - from) * k))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [v])
  return <>{n}</>
}

function Donut({ parts }: { parts: Part[] }) {
  let acc = 0
  return (
    <svg viewBox="0 0 42 42" className="donut" role="img" aria-label="Распределение бизнесов">
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#26262d" strokeWidth="5" />
      {parts.map(p => {
        const v = (p.value / TOTAL) * 100
        const el = v > 0 && (
          <circle
            key={p.label}
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            stroke={p.color}
            strokeWidth="5"
            strokeDasharray={`${v} ${100 - v}`}
            strokeDashoffset={25 - acc}
            className="seg"
          />
        )
        acc += v
        return el
      })}
      <text x="21" y="23.5" textAnchor="middle" className="donut-n">{TOTAL}</text>
    </svg>
  )
}

function Login({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    setBusy(false)
    if (error) setErr('Неверный email или пароль')
    else onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h2>Вход администратора</h2>
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        <input type="password" placeholder="Пароль" value={pass} onChange={e => setPass(e.target.value)} required />
        {err && <p className="err">{err}</p>}
        <button className="btn gold" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
    </div>
  )
}

export default function App() {
  const [biz, setBiz] = useState<Business[]>([])
  const [hist, setHist] = useState<HistoryRow[]>([])
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [admin, setAdmin] = useState(false)
  const [login, setLogin] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [asc, setAsc] = useState(true)

  const load = useCallback(async () => {
    const [b, h] = await Promise.all([
      supabase.from('businesses').select('*').order('id'),
      supabase.from('history').select('*').order('id', { ascending: false }).limit(100),
    ])
    const err = b.error ?? h.error
    if (err) return setError('Ошибка загрузки: ' + err.message)
    setBiz(b.data as Business[])
    setHist(h.data as HistoryRow[])
  }, [])

  // данные + синхронизация в реальном времени (+ подстраховка раз в 30 сек)
  useEffect(() => {
    if (!configured) return
    load()
    const timer = setInterval(load, 30000)
    const ch = supabase
      .channel('opg-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'businesses' }, p => {
        const n = p.new as Business
        setBiz(a => a.map(x => (x.id === n.id ? n : x)))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'history' }, p => {
        const n = p.new as HistoryRow
        setHist(a => (a.some(x => x.id === n.id) ? a : [n, ...a].slice(0, 100)))
      })
      .subscribe(s => {
        const ok = String(s) === 'SUBSCRIBED'
        setLive(ok)
        if (ok) load()
      })
    return () => {
      clearInterval(timer)
      supabase.removeChannel(ch)
    }
  }, [load])

  // авторизация: права определяет база (таблица admins), а не сайт
  useEffect(() => {
    if (!configured) return
    const check = async (s: Session | null) => {
      setEmail(s?.user.email ?? null)
      if (!s) return setAdmin(false)
      const { data } = await supabase.rpc('is_admin')
      setAdmin(data === true)
    }
    supabase.auth.getSession().then(({ data }) => check(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => check(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const setOwner = async (b: Business, owner: Owner) => {
    const patch = (o: Owner) => setBiz(a => a.map(x => (x.id === b.id ? { ...x, owner: o } : x)))
    patch(owner)
    const { data, error: e } = await supabase.from('businesses').update({ owner }).eq('id', b.id).select('id')
    if (e || !data?.length) {
      patch(b.owner)
      setError(e?.message ?? 'Нет прав на изменение')
    }
  }

  const rename = async (b: Business, name: string) => {
    const { error: e } = await supabase.from('businesses').update({ name }).eq('id', b.id)
    if (e) setError(e.message)
  }

  const reset = async () => {
    if (!window.confirm('Сбросить владельцев ВСЕХ бизнесов? Все 76 станут свободными, изменения попадут в историю.')) return
    const { error: e } = await supabase.rpc('reset_all')
    if (e) setError(e.message)
    else load()
  }

  const stats = useMemo(() => {
    const counts = OPGS.map(o => ({ ...o, list: biz.filter(b => b.owner === o.id) }))
    return { counts, free: biz.filter(b => b.owner === null).length }
  }, [biz])

  const sum = stats.counts.reduce((s, c) => s + c.list.length, 0) + stats.free
  const parts: Part[] = [
    ...stats.counts.map(c => ({ label: c.name, value: c.list.length, color: c.color })),
    { label: 'Свободно', value: stats.free, color: '#4b4b55' },
  ]
  const last = biz.length ? Math.max(...biz.map(b => Date.parse(b.updated_at))) : 0

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return biz
      .filter(b => (filter === 'all' ? true : filter === 'free' ? b.owner === null : b.owner === filter))
      .filter(b => !s || String(b.id).includes(s) || b.name.toLowerCase().includes(s))
      .sort((a, b) => (asc ? a.id - b.id : b.id - a.id))
  }, [biz, q, filter, asc])

  const exportCsv = () => {
    const out: (string | number)[][] = [
      ['№', 'Название', 'Владелец', 'Обновлено'],
      ...biz.map(b => [b.id, b.name, opgName(b.owner), fmt(b.updated_at)]),
      [],
      ['ОПГ', 'Бизнесов', 'Доля, %'],
      ...stats.counts.map(c => [c.name, c.list.length, pct(c.list.length)]),
      ['Свободно', stats.free, pct(stats.free)],
      ['Итого', sum, pct(sum)],
    ]
    const csv = out.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `opg-business-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <div className="app">
      <header>
        <h1>OPG BUSINESS CONTROL</h1>
        <div className="row">
          <span className={'live' + (live ? ' on' : '')}>{live ? 'Онлайн' : 'Нет связи'}</span>
          <button className="btn" onClick={exportCsv} disabled={!biz.length}>Экспорт CSV</button>
          {admin && <button className="btn danger" onClick={reset}>Сбросить всё</button>}
          {email ? (
            <>
              <span className="mu">{admin ? 'Администратор' : 'Только просмотр'}</span>
              <button className="btn" onClick={() => supabase.auth.signOut()}>Выйти</button>
            </>
          ) : (
            <button className="btn gold" onClick={() => setLogin(true)}>Вход для админа</button>
          )}
        </div>
      </header>

      {!configured && <p className="err">Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY — см. README.</p>}
      {error && <p className="err" onClick={() => setError('')}>{error} (нажмите, чтобы скрыть)</p>}

      <section className="grid hero">
        <div className="card">
          <Donut parts={parts} />
          <ul className="legend">
            {parts.map(p => (
              <li key={p.label}>
                <i style={{ background: p.color }} />
                {p.label}
                <b>{p.value}</b>
                <span className="mu">{pct(p.value)}%</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="kpis">
          <div className="card kpi"><span>Всего бизнесов</span><b>{TOTAL}</b></div>
          <div className="card kpi"><span>Свободно</span><b><Num v={stats.free} /></b></div>
          <div className="card kpi">
            <span>Контроль суммы</span>
            <b className={sum === TOTAL ? '' : 'bad'}>{sum} из {TOTAL}</b>
          </div>
          <div className="card kpi"><span>Последнее обновление</span><b className="sm">{last ? fmt(last) : '—'}</b></div>
        </div>
      </section>

      <section className="grid opgs">
        {stats.counts.map(c => (
          <div className="card opg" key={c.id} style={{ '--c': c.color } as CSSProperties}>
            <h2>{c.name}</h2>
            <div className="big"><Num v={c.list.length} /><small>{pct(c.list.length)}% от {TOTAL}</small></div>
            <div className="bar"><i style={{ width: pct(c.list.length) + '%' }} /></div>
            <div className="chips">
              {c.list.length ? c.list.map(b => <span key={b.id}>№{b.id} {b.name}</span>) : <em className="mu">Пока нет бизнесов</em>}
            </div>
          </div>
        ))}
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="row tool">
          <h2>Бизнесы ({rows.length})</h2>
          <input placeholder="Поиск по номеру или названию" value={q} onChange={e => setQ(e.target.value)} />
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)}>
            <option value="all">Все</option>
            <option value="free">Свободные</option>
            {OPGS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn" onClick={() => setAsc(!asc)}>Номер {asc ? '↑' : '↓'}</button>
        </div>
        <div className="tw">
          <table>
            <thead>
              <tr><th>№</th><th>Название</th><th>Владелец</th></tr>
            </thead>
            <tbody>
              {configured && !error && !biz.length && <tr><td colSpan={3}>Загрузка…</td></tr>}
              {rows.map(b => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>
                    {admin ? (
                      <input
                        className="inl"
                        key={b.name}
                        defaultValue={b.name}
                        onBlur={e => {
                          const v = e.target.value.trim()
                          if (!v) e.target.value = b.name
                          else if (v !== b.name) rename(b, v)
                        }}
                      />
                    ) : (
                      b.name
                    )}
                  </td>
                  <td>
                    {admin ? (
                      <select value={b.owner ?? ''} onChange={e => setOwner(b, (e.target.value || null) as Owner)}>
                        <option value="">Свободен</option>
                        {OPGS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    ) : (
                      <span className="tag" style={{ '--c': colorOf(b.owner) } as CSSProperties}>{opgName(b.owner)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>История изменений</h2>
        {hist.length ? (
          <ul className="hist">
            {hist.map(h => (
              <li key={h.id}>
                <time>{fmt(h.changed_at)}</time>
                <b>{h.changed_by}</b> передал «№{h.business_id} {h.business_name}»: {opgName(h.from_owner)} → {opgName(h.to_owner)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mu">Изменений пока нет.</p>
        )}
      </section>

      {login && <Login onClose={() => setLogin(false)} />}
    </div>
  )
}
