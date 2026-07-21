export default function SectionCard({ title, right, children }) {
  return (
    <section className="rounded-3xl border border-border/60 bg-card/40 backdrop-blur-xl shadow-sm">
      <div className="px-6 py-5 border-b border-border/50 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {right}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

