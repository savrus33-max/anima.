import Link from "next/link";
export default function NotFound(){return <main className="error-page"><strong>404</strong><h1>Кажется, это другой мир</h1><p>Такой страницы или аниме пока нет. Но в нашем каталоге ещё много отличных историй.</p><Link href="/catalog" className="button button-primary">Вернуться в каталог →</Link></main>;}
