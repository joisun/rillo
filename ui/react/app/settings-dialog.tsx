import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { useState } from 'react'
import { Modal, ModalOverlay } from 'react-aria-components/Modal'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { queryKeys } from '@/lib/query/keys'
import { useDashboardApi } from './app-providers'

export function SettingsDialog() {
  const api = useDashboardApi()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.settings(),
    enabled: open,
    staleTime: 0,
  })
  const save = useMutation({
    mutationFn: (terminal: string) => api.updateSettings({ resume_terminal: terminal }),
    onSuccess: (response) => queryClient.setQueryData(queryKeys.settings, response),
  })
  const options = settings.data?.terminal_options ?? []

  return (
    <Dialog isOpen={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      save.reset()
    }}>
      <Button aria-label="打开设置" isIconOnly size="xs" variant="quiet">
        <Settings aria-hidden="true" />
      </Button>
      <ModalOverlay className="settings-overlay" isDismissable={!save.isPending} isKeyboardDismissDisabled={save.isPending}>
        <Modal className="settings-modal">
          <DialogContent aria-label="设置" showCloseButton={!save.isPending}>
            <DialogHeader>
              <DialogTitle>设置</DialogTitle>
              <DialogDescription>{settings.data?.local_actions_supported === false ? '复制 Session ID 后，在服务器终端恢复会话。' : '选择恢复 Codex 会话时使用的终端。'}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              {settings.isPending ? <p role="status">正在读取设置…</p> : null}
              {settings.isError ? (
                <div role="alert">
                  <p>{settings.error.message}</p>
                  <Button size="sm" variant="secondary" onPress={() => void settings.refetch()}>重新读取</Button>
                </div>
              ) : null}
              {settings.data && settings.data.local_actions_supported !== false ? (
                <>
                  <Select
                    aria-label="恢复会话使用的终端"
                    selectedKey={settings.data.settings.resume_terminal}
                    disabledKeys={options.filter((option) => !option.available).map((option) => option.id)}
                    isDisabled={save.isPending || settings.isFetching || settings.isError}
                    onSelectionChange={(key) => {
                      if (key !== null && key !== settings.data.settings.resume_terminal) save.mutate(String(key))
                    }}
                  >
                    <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem id={option.id} key={option.id} textValue={option.label}>
                          {option.label}{option.available ? '' : ' · 未安装'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-fg-muted">选择后自动保存，下次恢复会话时生效。</p>
                </>
              ) : null}
              {save.isPending ? <p role="status">正在保存…</p> : null}
              {save.isSuccess ? <p role="status">设置已保存</p> : null}
              {save.isError ? <p role="alert">{save.error.message}</p> : null}
            </DialogBody>
          </DialogContent>
        </Modal>
      </ModalOverlay>
    </Dialog>
  )
}
