import { useTranslation } from '@nocobase/i18n/client';
import { ChevronDownIcon, ListPlusIcon, PlusIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';

/**
 * The issues page's split button (§G): "New issue" opens the `new` dialog, the menu offers "Batch entry", the
 * `intake` drawer. Both are child routes of `/issues` and keep the list's query string.
 */
export function NewIssueButton({
  variant = 'default',
}: {
  readonly variant?: 'default' | 'outline';
}): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <ButtonGroup>
      <Button
        variant={variant}
        nativeButton={false}
        render={<Link to={{ pathname: 'new', search: location.search }} />}
      >
        <PlusIcon data-icon='inline-start' />
        {t('np.issues.new')}
        {variant === 'default' ? (
          <Kbd data-icon='inline-end' aria-hidden='true'>
            C
          </Kbd>
        ) : null}
      </Button>
      <ButtonGroupSeparator />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={variant}
              size='icon'
              aria-label={t('np.issues.moreCreate')}
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() =>
                void navigate({ pathname: 'new', search: location.search })
              }
            >
              <PlusIcon />
              {t('np.issues.new')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void navigate({ pathname: 'intake', search: location.search })
              }
            >
              <ListPlusIcon />
              {t('np.intake.openDrawer')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
