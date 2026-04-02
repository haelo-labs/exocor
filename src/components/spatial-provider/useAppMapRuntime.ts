import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as DOMScannerModule from '../../core/DOMScanner';
import {
  clearAppMapCache,
  readCachedAppMapWithReason,
  resolveCurrentAppCacheScope,
  saveAppMapToCache,
  type DOMScannerPolicy
} from '../../core/DOMScanner';
import type { AppMap, DOMCapabilityMap } from '../../types';
import { buildFallbackAppMapFromDom } from './shared';

interface UseAppMapRuntimeOptions {
  appMapDiscoveryEnabled: boolean;
  domMap: DOMCapabilityMap;
  domMapRef: MutableRefObject<DOMCapabilityMap>;
  domScannerPolicy: DOMScannerPolicy;
  onAppMapped?: ((appMap: AppMap) => void) | undefined;
}

interface AppMapRuntime {
  appMap: AppMap | null;
  appMapRef: MutableRefObject<AppMap | null>;
  discoveryPromiseRef: MutableRefObject<Promise<AppMap | null> | null>;
  isDiscovering: boolean;
  setAndNotifyAppMap: (nextAppMap: AppMap | null) => void;
  runAppMapDiscovery: (options: {
    showOverlay: boolean;
    reason: string;
    forceRefresh?: boolean;
  }) => Promise<AppMap | null>;
  awaitBootstrappedAppMap: () => Promise<AppMap | null>;
  saveFallbackAppMapToCache: (nextAppMap: AppMap) => void;
}

export function useAppMapRuntime({
  appMapDiscoveryEnabled,
  domMap,
  domMapRef,
  domScannerPolicy,
  onAppMapped
}: UseAppMapRuntimeOptions): AppMapRuntime {
  const [appMap, setAppMap] = useState<AppMap | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const appMapRef = useRef<AppMap | null>(null);
  const discoveryPromiseRef = useRef<Promise<AppMap | null> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const setAndNotifyAppMap = useCallback(
    (nextAppMap: AppMap | null) => {
      appMapRef.current = nextAppMap;
      setAppMap(nextAppMap);
      if (nextAppMap) {
        onAppMapped?.(nextAppMap);
      }
    },
    [onAppMapped]
  );

  const runAppMapDiscovery = useCallback(
    async ({
      showOverlay,
      reason,
      forceRefresh = false
    }: {
      showOverlay: boolean;
      reason: string;
      forceRefresh?: boolean;
    }): Promise<AppMap | null> => {
      if (!appMapDiscoveryEnabled) {
        const fallbackAppMap = buildFallbackAppMapFromDom(domMapRef.current);
        if (isMountedRef.current) {
          setAndNotifyAppMap(fallbackAppMap);
          setIsDiscovering(false);
        }
        return fallbackAppMap;
      }

      if (discoveryPromiseRef.current) {
        return discoveryPromiseRef.current;
      }

      const scope = resolveCurrentAppCacheScope();
      if (forceRefresh) {
        clearAppMapCache(scope);
      }

      // eslint-disable-next-line no-console
      console.log(showOverlay ? '[Exocor Discovery] mount bootstrap reason:' : '[Exocor Discovery] refresh reason:', reason);

      if (showOverlay) {
        setAndNotifyAppMap(null);
        setIsDiscovering(true);
      }

      discoveryPromiseRef.current = (async () => {
        try {
          const discovered = await DOMScannerModule.discoverAppMap(domScannerPolicy);
          if (isMountedRef.current) {
            setAndNotifyAppMap(discovered);
          }
          return discovered;
        } catch {
          if (isMountedRef.current && showOverlay) {
            setAndNotifyAppMap(null);
          }
          return null;
        } finally {
          if (isMountedRef.current && showOverlay) {
            setIsDiscovering(false);
          }
          discoveryPromiseRef.current = null;
        }
      })();

      return discoveryPromiseRef.current;
    },
    [appMapDiscoveryEnabled, domMapRef, domScannerPolicy, setAndNotifyAppMap]
  );

  const awaitBootstrappedAppMap = useCallback(async (): Promise<AppMap | null> => {
    if (appMapRef.current) {
      return appMapRef.current;
    }
    if (discoveryPromiseRef.current) {
      return discoveryPromiseRef.current;
    }
    return appMapRef.current;
  }, []);

  useEffect(() => {
    if (!appMapDiscoveryEnabled) {
      const fallbackAppMap = buildFallbackAppMapFromDom(domMapRef.current);
      setAndNotifyAppMap(fallbackAppMap);
      setIsDiscovering(false);
      return;
    }

    const scope = resolveCurrentAppCacheScope();
    const cached = readCachedAppMapWithReason(scope);

    if (cached.appMap) {
      setAndNotifyAppMap(cached.appMap);
      setIsDiscovering(false);
      return;
    }

    void runAppMapDiscovery({
      showOverlay: true,
      reason: cached.reason
    });
  }, [appMapDiscoveryEnabled, domMapRef, runAppMapDiscovery, setAndNotifyAppMap]);

  useEffect(() => {
    if (!appMapDiscoveryEnabled) {
      setAndNotifyAppMap(buildFallbackAppMapFromDom(domMap));
    }
  }, [appMapDiscoveryEnabled, domMap, setAndNotifyAppMap]);

  const saveFallbackAppMapToCache = useCallback((nextAppMap: AppMap) => {
    if (appMapDiscoveryEnabled) {
      saveAppMapToCache(nextAppMap);
      setAndNotifyAppMap(nextAppMap);
    }
  }, [appMapDiscoveryEnabled, setAndNotifyAppMap]);

  return {
    appMap,
    appMapRef,
    discoveryPromiseRef,
    isDiscovering,
    setAndNotifyAppMap,
    runAppMapDiscovery,
    awaitBootstrappedAppMap,
    saveFallbackAppMapToCache
  };
}
