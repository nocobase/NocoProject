import { BotIcon } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

export interface NpMarkdownProps {
  readonly content: string;
  readonly className?: string;
}

// `mention://agent/<id>` is the NocoProject mention link (protocol §2). react-markdown's default transform drops
// unknown schemes, so mentions are let through here and rendered as chips; every other URL keeps the default
// sanitisation.
function urlTransform(url: string): string {
  return url.startsWith('mention://agent/') ? url : defaultUrlTransform(url);
}

function MentionOrLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentProps<'a'> & { readonly node?: unknown }): ReactElement {
  if (href?.startsWith('mention://agent/')) {
    return (
      <span className='inline-flex items-center gap-0.5 rounded-md bg-secondary px-1 py-px align-baseline font-medium text-secondary-foreground'>
        <BotIcon className='size-3' aria-hidden='true' />
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target='_blank'
      rel='noreferrer'
      className='font-medium text-primary underline underline-offset-4'
      {...props}
    >
      {children}
    </a>
  );
}

// Compact prose for comments and descriptions: the Typography primitives are sized for long-form pages, which would
// make every comment look like an article. Only tokens and the Tailwind scale are used.
const components: Components = {
  a: MentionOrLink,
  p: ({ node: _node, ...props }) => (
    <p className='leading-6 not-first:mt-2' {...props} />
  ),
  h1: ({ node: _node, ...props }) => (
    <h1 className='mt-4 mb-2 text-lg font-semibold first:mt-0' {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className='mt-4 mb-2 text-base font-semibold first:mt-0' {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className='mt-3 mb-1.5 text-sm font-semibold first:mt-0' {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className='my-2 ml-5 list-disc space-y-1' {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className='my-2 ml-5 list-decimal space-y-1' {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className='my-2 border-l-2 pl-3 text-muted-foreground'
      {...props}
    />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn(
        'rounded bg-muted px-1 py-0.5 font-mono text-xs',
        className,
      )}
      {...props}
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className='my-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs [&>code]:bg-transparent [&>code]:p-0'
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className='my-2 w-full overflow-x-auto'>
      <table className='w-full text-sm' {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th className='border px-2 py-1 text-left font-medium' {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className='border px-2 py-1' {...props} />
  ),
  hr: ({ node: _node, ...props }) => <hr className='my-3' {...props} />,
};

/** Markdown for issue descriptions and comments, with agent mentions shown as chips. */
export function NpMarkdown({
  content,
  className,
}: NpMarkdownProps): ReactElement {
  return (
    <div className={cn('min-w-0 text-sm wrap-anywhere', className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}
