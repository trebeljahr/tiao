import Document, { Head, Html, Main, NextScript } from "next/document";
import Script from "next/script";

export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="en" suppressHydrationWarning>
        <Head>
          <Script
            src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
            rel="stylesheet"
          />
        </Head>

        <body className="prose md:prose-lg xl:prose-xl bg-white dark:bg-gray-900 dark:prose-invert hover:prose-a:text-myBlue max-w-none prose-img:m-0 w-full">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
