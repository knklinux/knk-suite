import React, { useState } from 'react';
import PublicCameras from './PublicCameras';
import CameraSources from './CameraSources';
import LiveCams from './LiveCams';

// ============================================================================
// CamerasHub — vista UNIFICADA de cámaras.
//
//   · Webcams en vivo  → PublicCameras: streams públicos indexados (Insecam,
//     Windy…) y auditoría del reproductor HLS de cada cámara.
//   · Fuentes HLS/RTSP → CameraSources: biblioteca de streams propia.
//   · EN DIRECTO       → LiveCams: mosaico + NASA/cielo/monumentos/hacking/
//     community/custom (recableado 21-sep: estaba sin importar y Vite lo
//     sacaba del bundle).
//
// La BÚSQUEDA en índices públicos (Shodan/FOFA/ZoomEye/Netlas/Censys/
// GreyNoise + InternetDB) NO vive aquí: vive en OSINT Hub (ExposedCameras
// integrado), porque es inteligencia, no visualización. Así la consulta a
// Shodan tiene una sola superficie y no se duplica (defecto señalado por la
// auditoría: docs/AUDITORIA-MODULOS-2026-09-10.md).
// ============================================================================
const TABS = [
  { id: 'vivo', label: '🔴 Webcams en vivo', C: PublicCameras },
  { id: 'fuentes', label: '📡 Fuentes HLS/RTSP', C: CameraSources },
  { id: 'directo', label: '📺 EN DIRECTO', C: LiveCams },
];

export default function CamerasHub({ api }) {
  const [tab, setTab] = useState('vivo');
  const Active = (TABS.find((t) => t.id === tab) || TABS[0]).C;
  return (
    <div>
      <div className="tabbar" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? '' : 'btn-outline'}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <Active api={api} />
    </div>
  );
}
