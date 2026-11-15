import partyFlag from './assets/co-dang.svg';
import nationalFlag from './assets/co-to-quoc.svg';

export default function GovernmentMasthead() {
  return <header className="government-masthead">
    <div className="government-identity">
      <div className="national-flags" role="group" aria-label="Cờ Đảng và cờ Tổ quốc">
        <img src={partyFlag} width="66" height="44" alt="Cờ Đảng Cộng sản Việt Nam" />
        <img src={nationalFlag} width="66" height="44" alt="Quốc kỳ Việt Nam" />
      </div>
      <div className="government-title">
        <span>CỔNG THÔNG TIN HỘI THI TRỰC TUYẾN</span>
        <strong>HỘI THI NGHIỆP VỤ XÃ TÂN HÒA</strong>
        <small>Dành cho cán bộ, công chức xã Tân Hòa</small>
      </div>
    </div>
    <div className="government-motto">
      <span>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</span>
      <strong>Độc lập – Tự do – Hạnh phúc</strong>
      <i aria-hidden="true" />
    </div>
  </header>;
}
