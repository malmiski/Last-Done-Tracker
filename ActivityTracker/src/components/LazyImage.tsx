import React, { useState, useEffect, useRef } from 'react';
import { View, Image, ImageProps, Platform, StyleProp, ViewStyle, StyleSheet } from 'react-native';

interface LazyImageProps extends ImageProps {
  placeholderStyle?: StyleProp<ViewStyle>;
}

export const LazyImage: React.FC<LazyImageProps> = ({ source, style, placeholderStyle, ...props }) => {
  const [isVisible, setIsVisible] = useState(Platform.OS !== 'web');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const containerRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setObjectUrl(null);
    if (!isVisible) return;

    let isMounted = true;
    let urlToRevoke: string | null = null;

    if (typeof source === 'object' && source !== null && 'uri' in source) {
      const uri = (source as any).uri;
      if (typeof uri === 'string' && uri.startsWith('data:')) {
        fetch(uri)
          .then(res => res.blob())
          .then(blob => {
            if (!isMounted) return;
            const url = URL.createObjectURL(blob);
            urlToRevoke = url;
            setObjectUrl(url);
          })
          .catch(e => {
            console.error("Error creating object URL in LazyImage", e);
          });
      }
    }

    return () => {
      isMounted = false;
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke);
      }
    };
  }, [source, isVisible]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '200px',
        threshold: 0.01,
      }
    );

    const el = containerRef.current;
    if (el) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  if (isVisible) {
    let finalSource = source;
    let isBase64 = false;

    if (typeof source === 'object' && source !== null && 'uri' in source) {
      const uri = (source as any).uri;
      if (typeof uri === 'string' && uri.startsWith('data:')) {
        isBase64 = true;
      }
    }

    if (Platform.OS === 'web' && isBase64 && !objectUrl) {
      // Waiting for blob conversion
      return (
        <View
          ref={containerRef}
          style={[
            style,
            placeholderStyle,
            { backgroundColor: 'transparent' }
          ]}
        />
      );
    }

    if (objectUrl && typeof source === 'object' && source !== null && 'uri' in source) {
      finalSource = { ...source, uri: objectUrl };
    }
    return <Image source={finalSource} style={style} {...props} />;
  }

  return (
    <View
      ref={containerRef}
      style={[
        style,
        placeholderStyle,
        { backgroundColor: 'transparent' }
      ]}
    />
  );
};

export default LazyImage;
