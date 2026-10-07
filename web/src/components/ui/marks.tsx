// Piezas compartidas de la interfaz: marks. Partido de ui/index.tsx en la Fase 5 (ningún import cambia: index.tsx reexporta).
import { useState } from 'react';
import { crestColors, crestPaint, monogram } from '../../lib/teamColors';
import { countryName, flagSrc, leagueCountryLabel, leagueFlagSrc, UNKNOWN_COUNTRY } from '../../lib/countries';
/**
 * The 6px dot that says which side something belongs to.
 *
 * The same mark in front of a team's name, a hero figure's label and a factor's
 * value, so "blue = this one" is learned once and holds everywhere. It replaced
 * painting each of those in the series colour: a card carried a 15px bold blue
 * name, a 28px blue percentage and a blue bar segment, all repeating the one fact
 * that the bar already made obvious.
 */
export function SeriesDot({ color, className = '' }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * A team's crest: a small disc in the club's own colours with its monogram.
 *
 * The only place in the app where a team's own colour is allowed. Everything
 * that carries meaning — the bars, the grid, the bands — stays on the shared
 * validated palette, so blue is still the home side whatever the two clubs
 * happen to wear. The crest answers "which club is this", and it answers it
 * faster than reading a name does, which is the whole reason to spend the ink.
 *
 * When the colours are not known the crest goes neutral rather than inventing
 * one, so a card never asserts that a club plays in a colour it does not.
 *
 * `logo` layers a real badge on top when the database happens to have one (the
 * basketball ingest fetches them). It fades in only after it loads and removes
 * itself if it 404s, so a missing image is never a broken-image icon — the
 * coloured disc underneath is always a complete answer on its own.
 */
export function TeamCrest({
  league,
  name,
  code,
  logo,
  // 26, up from 22. A three-letter monogram is sized at a fraction of the disc so
  // it fits, and on a 22px disc that worked out to 7.5px — small enough that CHE
  // and ARS were shapes rather than letters. The disc grew with the rest of the
  // type scale so the floor below never has to clamp.
  size = 26,
  className = '',
}: {
  league: string;
  name: string;
  code?: string | null;
  logo?: string | null;
  size?: number;
  className?: string;
}) {
  const [logoOk, setLogoOk] = useState(false);
  const paint = crestPaint(crestColors(league, name, code));
  const text = monogram(name, code);
  return (
    <span
      aria-hidden
      title={name}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: paint.fill,
        boxShadow: `inset 0 0 0 1.5px ${paint.ring}`,
      }}
    >
      <span
        className="font-bold leading-none tracking-tight"
        style={{
          color: paint.ink,
          // Three letters have to fit the same disc two letters do — but never
          // below 10px, because past that a monogram stops being readable and the
          // crest may as well be a plain dot. On a small disc the letters are
          // allowed to crowd instead of shrinking out of legibility.
          fontSize: Math.max(10, size * (text.length > 2 ? 0.34 : 0.4)),
          opacity: logoOk ? 0 : 1,
        }}
      >
        {text}
      </span>
      {logo && (
        <img
          src={logo}
          alt=""
          loading="lazy"
          onLoad={() => setLogoOk(true)}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className="absolute inset-0 h-full w-full object-contain p-[2px]"
        />
      )}
    </span>
  );
}

/**
 * La bandera de un país, o sus tres letras. Nunca la bandera de otro país.
 *
 * ===========================================================================
 * LO QUE ESTE COMPONENTE REEMPLAZA, Y POR QUÉ NO ERA UN DETALLE
 * ===========================================================================
 * Antes esto era un emoji: `flag(ioc)` convertía el código en indicadores regionales
 * Unicode. Dos problemas, y el segundo es el grave.
 *
 *   1. EN WINDOWS NO EXISTEN. Segoe UI Emoji no trae glifos de bandera, así que lo que
 *      se ve son las dos letras del código: un español sale como «ES». La app se veía
 *      distinta según el sistema y en el más común se veía peor.
 *
 *   2. UNA CUARTA PARTE ERAN LA BANDERA EQUIVOCADA. El respaldo cortaba las dos primeras
 *      letras del código del COI, y `RSA`→`RS` es Serbia, `CHI`→`CH` es Suiza,
 *      `EST`→`ES` es España. 318 jugadores de 1.272, todos con una bandera segura de sí
 *      misma. El detalle de cómo se arregló está en `lib/countries.ts`.
 *
 * Ahora el SVG sale de `web/public/flags/`, que está en el repo: sin red, sin CDN, y
 * `verify:data` comprueba que todos los países de la base tienen su fichero.
 *
 * ===========================================================================
 * EL RESPALDO DICE EL CÓDIGO, NO ADIVINA UN PAÍS
 * ===========================================================================
 * Si el código no está en la tabla —datos nuevos, un país que nadie previó— sale una
 * pastilla gris con las tres letras. Es fea a propósito: se lee como «esto es un código
 * que no sé traducir» y no como una afirmación sobre la nacionalidad de nadie.
 */
export function Flag({
  country,
  name,
  // 11px de alto. Una bandera 4:3 a 11px son 15px de ancho, que al lado de un nombre a
  // 13px pesa lo mismo que una letra mayúscula: se ve de qué país es sin competir con
  // el nombre, que es el dato.
  height = 11,
  className = '',
}: {
  country: string | null | undefined;
  /** El nombre en español, si quien llama ya lo tiene. Si no, lo resuelve él. */
  name?: string;
  height?: number;
  className?: string;
}) {
  const code = country?.trim().toUpperCase() ?? '';
  // Sin país no se pinta NADA. Ni un hueco, ni un interrogante: la fila de al lado no
  // tiene por qué desalinearse porque a un jugador le falte un dato.
  if (!country || UNKNOWN_COUNTRY.has(code)) return null;
  return (
    <FlagImg
      src={flagSrc(country)}
      label={name ?? countryName(country)}
      code={code}
      height={height}
      className={className}
    />
  );
}

/**
 * La bandera de la sede de una liga, para las pastillas de las cinco pestañas.
 *
 * Separada de `Flag` porque el dato de entrada no es el mismo: aquí llega o un ISO-2
 * (`"US"`) o una etiqueta con el emoji delante (`"🇪🇸 España"`), según el deporte, y hay
 * que resolver además dos banderas que no son países del COI. Lo resuelve
 * `leagueFlagSrc`; el dibujo es el mismo.
 *
 * Cuando no se resuelve NO sale la pastilla con el código, que es lo que hace `Flag`:
 * sale nada. El nombre de la liga está a un milímetro y «PREMIER LEAGUE» ya dice de
 * sobra dónde se juega, mientras que en una lista de cincuenta apellidos el código de
 * país sí añade algo.
 */
export function LeagueFlag({
  country,
  height = 11,
  className = '',
}: {
  country: string | null | undefined;
  height?: number;
  className?: string;
}) {
  const src = leagueFlagSrc(country);
  if (!src) return null;
  return (
    <FlagImg
      src={src}
      label={leagueCountryLabel(country)}
      code=""
      height={height}
      className={className}
    />
  );
}

/**
 * El dibujo, compartido por las dos.
 *
 * Lo que hace que merezca ser una función y no dos copias es el par de estados: la
 * bandera se revela SOLO cuando ha cargado (`ok`) y cae al respaldo solo si falla
 * (`failed`). Duplicar eso son dos sitios donde olvidarse del `onError` y dejar el icono
 * de imagen rota, que es exactamente lo que no debe pasar en una fila de datos.
 */
function FlagImg({
  src,
  label,
  code,
  height,
  className,
}: {
  src: string | null;
  label: string;
  /** Las tres letras del respaldo. Vacío = sin respaldo, no se pinta nada. */
  code: string;
  height: number;
  className: string;
}) {
  const [ok, setOk] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    if (!code) return null;
    return (
      <span
        title={label}
        className={`inline-block shrink-0 rounded-[2px] bg-(--raised-2) px-1 font-medium tabular-nums text-(--ink-muted) ${className}`}
        style={{ fontSize: Math.max(9, height * 0.82), lineHeight: `${height + 2}px` }}
      >
        {code}
      </span>
    );
  }

  return (
    <span
      title={label}
      className={`relative inline-block shrink-0 overflow-hidden rounded-[2px] ${className}`}
      style={{
        height,
        width: height * (4 / 3),
        // El fondo se ve mientras carga y ocupa el mismo sitio que la bandera, así que
        // la línea no salta cuando llega. Y el borde interior despega del fondo oscuro
        // las banderas que tienen blanco en el canto (Japón, Suiza).
        backgroundColor: ok ? 'transparent' : 'var(--raised-2)',
        boxShadow: ok ? 'inset 0 0 0 1px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        onLoad={() => setOk(true)}
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: ok ? 1 : 0 }}
      />
    </span>
  );
}
