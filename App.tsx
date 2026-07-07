import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  StatusBar as NativeStatusBar,
  findNodeHandle,
  PanResponder,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Activity,
  Check,
  ClipboardList,
  LineChart,
  Plus,
  Scale,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { type ComponentType, type RefObject, forwardRef, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEYS = {
  profile: 'weight-tracker/profile',
  weights: 'weight-tracker/weights',
  inbody: 'weight-tracker/inbody',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ANDROID_TOP_INSET = Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 14 : 0;
const KEYBOARD_EXTRA_SPACE = 180;

type Profile = {
  heightCm: number;
  startWeightKg: number;
  targetWeightKg?: number;
  createdAt: string;
};

type WeightEntry = {
  id: string;
  date: string;
  weightKg: number;
  memo?: string;
};

type InbodyEntry = {
  id: string;
  date: string;
  weightKg?: number;
  skeletalMuscleKg?: number;
  bodyFatPercent?: number;
  bodyFatMassKg?: number;
  visceralFatLevel?: number;
  memo?: string;
};

type TabKey = 'weight' | 'inbody' | 'profile';
type AppIcon = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

const colors = {
  bg: '#F6F7FB',
  surface: '#FFFFFF',
  ink: '#151922',
  muted: '#667085',
  border: '#DCE1EA',
  blue: '#2563EB',
  blueSoft: '#EAF1FF',
  green: '#159A74',
  greenSoft: '#E7F7F1',
  amber: '#B7791F',
  amberSoft: '#FFF4D8',
  red: '#D64545',
  redSoft: '#FDECEC',
};

const todayISO = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseLocalDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
};

const formatShortDateFromTime = (time: number) => {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}.${day}`;
};

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

const parseDecimal = (value: string) => {
  const parsed = Number(value.replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
};

const optionalDecimal = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = parseDecimal(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatDate = (date: string) => date.replaceAll('-', '.');
const formatKg = (value: number) => `${value.toFixed(1)}kg`;
const signedKg = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}kg`;

const sortByDateAsc = <T extends { date: string }>(items: T[]) =>
  [...items].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));

const sortByDateDesc = <T extends { date: string }>(items: T[]) =>
  [...items].sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const distanceBetweenTouches = (touches: ReadonlyArray<{ pageX: number; pageY: number }>) => {
  if (touches.length < 2) {
    return 0;
  }

  const [first, second] = touches;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
};

const scrollFieldIntoView = (
  scrollRef: RefObject<ScrollView | null>,
  fieldRef: RefObject<View | null>,
  offset = 84,
) => {
  const measureAndScroll = () => {
    const scrollNode = findNodeHandle(scrollRef.current);
    if (!scrollNode || !fieldRef.current) {
      return;
    }

    fieldRef.current.measureLayout(
      scrollNode,
      (_x, y) => {
        scrollRef.current?.scrollTo({
          animated: true,
          y: Math.max(0, y - offset),
        });
      },
      () => undefined,
    );
  };

  setTimeout(measureAndScroll, 80);
  setTimeout(measureAndScroll, 280);
};

function getProgress(profile: Profile, currentWeight: number) {
  if (profile.targetWeightKg === undefined) {
    return undefined;
  }

  const start = profile.startWeightKg;
  const target = profile.targetWeightKg;
  if (start === target) {
    return currentWeight === target ? 1 : 0;
  }

  const progress =
    target < start
      ? (start - currentWeight) / (start - target)
      : (currentWeight - start) / (target - start);

  return clamp(progress, 0, 1);
}

function averageByWindow(entries: WeightEntry[], windowDays: number) {
  const sorted = sortByDateAsc(entries);

  return sorted.map((entry) => {
    const currentTime = parseLocalDate(entry.date);
    const minTime = currentTime - (windowDays - 1) * DAY_MS;
    const values = sorted.filter((item) => {
      const time = parseLocalDate(item.date);
      return time >= minTime && time <= currentTime;
    });
    const average = values.reduce((sum, item) => sum + item.weightKg, 0) / values.length;

    return {
      date: entry.date,
      weightKg: average,
    };
  });
}

function AppButton({
  label,
  icon: Icon,
  onPress,
  variant = 'primary',
}: {
  label: string;
  icon: AppIcon;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && styles.pressed,
      ]}
    >
      <Icon color={variant === 'secondary' ? colors.ink : colors.surface} size={18} strokeWidth={2.4} />
      <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
  autoFocus?: boolean;
  returnKeyType?: 'next' | 'done';
  focusOffset?: number;
  onFocus?: () => void;
  onSubmitEditing?: () => void;
  scrollViewRef?: RefObject<ScrollView | null>;
};

const Field = forwardRef<TextInput, FieldProps>(function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  multiline = false,
  autoFocus = false,
  returnKeyType = 'next',
  focusOffset,
  onFocus,
  onSubmitEditing,
  scrollViewRef,
}, ref) {
  const containerRef = useRef<View>(null);

  const handleFocus = () => {
    onFocus?.();
    if (scrollViewRef) {
      scrollFieldIntoView(scrollViewRef, containerRef, focusOffset);
    }
  };

  return (
    <View ref={containerRef} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoFocus={autoFocus}
        blurOnSubmit
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor="#98A2B3"
        ref={ref}
        returnKeyType={multiline ? 'done' : returnKeyType}
        style={[styles.input, multiline && styles.memoInput]}
        value={value}
      />
    </View>
  );
});

function StatCard({
  label,
  value,
  tone = 'blue',
}: {
  label: string;
  value: string;
  tone?: 'blue' | 'green' | 'amber';
}) {
  return (
    <View
      style={[
        styles.statCard,
        tone === 'green' && styles.statGreen,
        tone === 'amber' && styles.statAmber,
      ]}
    >
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function WeightChart({ entries, windowDays }: { entries: WeightEntry[]; windowDays: number }) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(320, Math.min(width - 32, 720));
  const chartHeight = 232;
  const padding = { top: 22, right: 20, bottom: 34, left: 42 };
  const sorted = useMemo(() => sortByDateAsc(entries), [entries]);
  const averages = useMemo(() => averageByWindow(entries, windowDays), [entries, windowDays]);
  const [chartZoom, setChartZoom] = useState(1);
  const chartZoomRef = useRef(1);
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length === 2,
        onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length === 2,
        onPanResponderGrant: (event) => {
          const distance = distanceBetweenTouches(event.nativeEvent.touches);
          if (distance > 0) {
            pinchStartRef.current = { distance, zoom: chartZoomRef.current };
          }
        },
        onPanResponderMove: (event) => {
          const start = pinchStartRef.current;
          const distance = distanceBetweenTouches(event.nativeEvent.touches);
          if (!start || distance <= 0) {
            return;
          }

          const nextZoom = clamp(start.zoom * (distance / start.distance), 1, 4);
          chartZoomRef.current = nextZoom;
          setChartZoom(nextZoom);
        },
        onPanResponderRelease: () => {
          pinchStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          pinchStartRef.current = null;
        },
      }),
    [],
  );

  if (sorted.length === 0) {
    return (
      <View style={styles.emptyChart}>
        <Scale color={colors.muted} size={28} />
        <Text style={styles.emptyTitle}>체중 기록 없음</Text>
      </View>
    );
  }

  const allValues = [...sorted.map((item) => item.weightKg), ...averages.map((item) => item.weightKg)];
  const minWeight = Math.min(...allValues);
  const maxWeight = Math.max(...allValues);
  const baseYMin = Math.floor((minWeight - 0.8) * 2) / 2;
  const baseYMax = Math.ceil((maxWeight + 0.8) * 2) / 2;
  const baseYMid = (baseYMin + baseYMax) / 2;
  const visibleYRange = Math.max((baseYMax - baseYMin) / chartZoom, 0.8);
  const yMin = baseYMid - visibleYRange / 2;
  const yMax = baseYMid + visibleYRange / 2;
  const fullMinTime = parseLocalDate(sorted[0].date);
  const fullMaxTime = parseLocalDate(sorted[sorted.length - 1].date);
  const fullTimeSpan = Math.max(fullMaxTime - fullMinTime, DAY_MS);
  const timeMid = (fullMinTime + fullMaxTime) / 2;
  const visibleTimeSpan = fullTimeSpan / chartZoom;
  const minTime = fullMinTime === fullMaxTime ? fullMinTime : timeMid - visibleTimeSpan / 2;
  const maxTime = fullMinTime === fullMaxTime ? fullMaxTime : timeMid + visibleTimeSpan / 2;
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const xForDate = (date: string) => {
    if (minTime === maxTime) {
      return padding.left + plotWidth / 2;
    }

    return padding.left + ((parseLocalDate(date) - minTime) / (maxTime - minTime)) * plotWidth;
  };

  const yForWeight = (weight: number) => {
    if (yMin === yMax) {
      return padding.top + plotHeight / 2;
    }

    return padding.top + ((yMax - weight) / (yMax - yMin)) * plotHeight;
  };

  const actualPoints = sorted.map((item) => `${xForDate(item.date)},${yForWeight(item.weightKg)}`).join(' ');
  const averagePoints = averages.map((item) => `${xForDate(item.date)},${yForWeight(item.weightKg)}`).join(' ');
  const gridValues = [yMin, (yMin + yMax) / 2, yMax];
  const startLabel = fullMinTime === fullMaxTime ? formatDate(sorted[0].date).slice(5) : formatShortDateFromTime(minTime);
  const endLabel =
    fullMinTime === fullMaxTime
      ? formatDate(sorted[sorted.length - 1].date).slice(5)
      : formatShortDateFromTime(maxTime);

  return (
    <View style={styles.chartWrap} {...panResponder.panHandlers}>
      <Svg width={chartWidth} height={chartHeight}>
        <Defs>
          <ClipPath id="plotClip">
            <Rect
              height={plotHeight}
              width={plotWidth}
              x={padding.left}
              y={padding.top}
            />
          </ClipPath>
        </Defs>
        {gridValues.map((value) => {
          const y = yForWeight(value);
          return (
            <G key={value.toFixed(2)}>
              <Line
                x1={padding.left}
                x2={chartWidth - padding.right}
                y1={y}
                y2={y}
                stroke={colors.border}
                strokeWidth={1}
              />
              <SvgText
                fill={colors.muted}
                fontSize="11"
                textAnchor="end"
                x={padding.left - 8}
                y={y + 4}
              >
                {value.toFixed(1)}
              </SvgText>
            </G>
          );
        })}

        <G clipPath="url(#plotClip)">
          {sorted.length > 1 && (
            <Polyline
              fill="none"
              points={actualPoints}
              stroke="#A7B2C3"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          )}
          {averages.length > 1 && (
            <Polyline
              fill="none"
              points={averagePoints}
              stroke={colors.blue}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3.5}
            />
          )}
          {sorted.map((item) => (
            <Circle
              cx={xForDate(item.date)}
              cy={yForWeight(item.weightKg)}
              fill={colors.surface}
              key={item.id}
              r={4.5}
              stroke={colors.ink}
              strokeWidth={1.8}
            />
          ))}
        </G>

        <SvgText fill={colors.muted} fontSize="11" textAnchor="start" x={padding.left} y={chartHeight - 8}>
          {startLabel}
        </SvgText>
        <SvgText
          fill={colors.muted}
          fontSize="11"
          textAnchor="end"
          x={chartWidth - padding.right}
          y={chartHeight - 8}
        >
          {endLabel}
        </SvgText>
      </Svg>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendDotActual]} />
          <Text style={styles.legendText}>실제</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, styles.legendLineAverage]} />
          <Text style={styles.legendText}>{windowDays}일 평균</Text>
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [inbodyEntries, setInbodyEntries] = useState<InbodyEntry[]>([]);
  const [tab, setTab] = useState<TabKey>('weight');
  const [windowDays, setWindowDays] = useState(7);

  const [heightInput, setHeightInput] = useState('');
  const [startWeightInput, setStartWeightInput] = useState('');
  const [targetWeightInput, setTargetWeightInput] = useState('');

  const [weightDate, setWeightDate] = useState(todayISO());
  const [weightInput, setWeightInput] = useState('');
  const [weightMemo, setWeightMemo] = useState('');

  const [inbodyDate, setInbodyDate] = useState(todayISO());
  const [inbodyWeight, setInbodyWeight] = useState('');
  const [skeletalMuscle, setSkeletalMuscle] = useState('');
  const [bodyFatPercent, setBodyFatPercent] = useState('');
  const [bodyFatMass, setBodyFatMass] = useState('');
  const [visceralFat, setVisceralFat] = useState('');
  const [inbodyMemo, setInbodyMemo] = useState('');

  const onboardingScrollRef = useRef<ScrollView>(null);
  const mainScrollRef = useRef<ScrollView>(null);
  const onboardingHeightRef = useRef<TextInput>(null);
  const onboardingStartWeightRef = useRef<TextInput>(null);
  const onboardingTargetWeightRef = useRef<TextInput>(null);
  const weightDateRef = useRef<TextInput>(null);
  const weightValueRef = useRef<TextInput>(null);
  const weightMemoRef = useRef<TextInput>(null);
  const inbodyDateRef = useRef<TextInput>(null);
  const inbodyWeightRef = useRef<TextInput>(null);
  const skeletalMuscleRef = useRef<TextInput>(null);
  const bodyFatPercentRef = useRef<TextInput>(null);
  const bodyFatMassRef = useRef<TextInput>(null);
  const visceralFatRef = useRef<TextInput>(null);
  const inbodyMemoRef = useRef<TextInput>(null);
  const profileHeightRef = useRef<TextInput>(null);
  const profileStartWeightRef = useRef<TextInput>(null);
  const profileTargetWeightRef = useRef<TextInput>(null);

  const focusNext = (ref: { current: TextInput | null }) => {
    requestAnimationFrame(() => ref.current?.focus());
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [profileValue, weightsValue, inbodyValue] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.profile),
          AsyncStorage.getItem(STORAGE_KEYS.weights),
          AsyncStorage.getItem(STORAGE_KEYS.inbody),
        ]);

        if (profileValue) {
          const savedProfile = JSON.parse(profileValue) as Profile;
          setProfile(savedProfile);
          setHeightInput(String(savedProfile.heightCm));
          setStartWeightInput(String(savedProfile.startWeightKg));
          setTargetWeightInput(
            savedProfile.targetWeightKg !== undefined ? String(savedProfile.targetWeightKg) : '',
          );
        }

        if (weightsValue) {
          setWeights(JSON.parse(weightsValue) as WeightEntry[]);
        }

        if (inbodyValue) {
          setInbodyEntries(JSON.parse(inbodyValue) as InbodyEntry[]);
        }
      } catch {
        Alert.alert('불러오기 실패', '저장된 데이터를 읽지 못했어요.');
      } finally {
        setIsReady(true);
      }
    };

    load();
  }, []);

  const sortedWeights = useMemo(() => sortByDateAsc(weights), [weights]);
  const latestWeight = sortedWeights[sortedWeights.length - 1];
  const latestInbody = useMemo(() => sortByDateAsc(inbodyEntries)[inbodyEntries.length - 1], [inbodyEntries]);

  const bmi = useMemo(() => {
    if (!profile || !latestWeight) {
      return undefined;
    }

    const heightM = profile.heightCm / 100;
    return latestWeight.weightKg / (heightM * heightM);
  }, [latestWeight, profile]);

  const sevenDayChange = useMemo(() => {
    if (sortedWeights.length < 2 || !latestWeight) {
      return undefined;
    }

    const latestTime = parseLocalDate(latestWeight.date);
    const startTime = latestTime - 7 * DAY_MS;
    const reference =
      sortedWeights.find((entry) => parseLocalDate(entry.date) >= startTime) ?? sortedWeights[0];

    return latestWeight.weightKg - reference.weightKg;
  }, [latestWeight, sortedWeights]);

  const progress = profile && latestWeight ? getProgress(profile, latestWeight.weightKg) : undefined;
  const goalStatusText =
    profile?.targetWeightKg !== undefined && latestWeight
      ? (() => {
          const distance = Math.abs(latestWeight.weightKg - profile.targetWeightKg);
          if (distance < 0.05) {
            return '도달';
          }

          const passedGoal =
            profile.targetWeightKg < profile.startWeightKg
              ? latestWeight.weightKg < profile.targetWeightKg
              : latestWeight.weightKg > profile.targetWeightKg;

          return `${distance.toFixed(1)}kg ${passedGoal ? '초과' : '남음'}`;
        })()
      : undefined;

  const persistProfile = async (nextProfile: Profile) => {
    setProfile(nextProfile);
    await AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(nextProfile));
  };

  const persistWeights = async (nextWeights: WeightEntry[]) => {
    const sorted = sortByDateDesc(nextWeights);
    setWeights(sorted);
    await AsyncStorage.setItem(STORAGE_KEYS.weights, JSON.stringify(sorted));
  };

  const persistInbody = async (nextEntries: InbodyEntry[]) => {
    const sorted = sortByDateDesc(nextEntries);
    setInbodyEntries(sorted);
    await AsyncStorage.setItem(STORAGE_KEYS.inbody, JSON.stringify(sorted));
  };

  const saveInitialProfile = async () => {
    const height = parseDecimal(heightInput);
    const startWeight = parseDecimal(startWeightInput);
    const targetWeight = optionalDecimal(targetWeightInput);

    if (!height || height < 80 || height > 240) {
      Alert.alert('키 확인', '키를 cm 단위로 다시 입력해 주세요.');
      return;
    }

    if (!startWeight || startWeight < 20 || startWeight > 300) {
      Alert.alert('시작 몸무게 확인', '몸무게를 kg 단위로 다시 입력해 주세요.');
      return;
    }

    if (
      targetWeightInput.trim() &&
      (targetWeight === undefined || targetWeight < 20 || targetWeight > 300)
    ) {
      Alert.alert('목표 몸무게 확인', '목표 몸무게를 kg 단위로 다시 입력해 주세요.');
      return;
    }

    const nextProfile: Profile = {
      heightCm: Number(height.toFixed(1)),
      startWeightKg: Number(startWeight.toFixed(1)),
      targetWeightKg: targetWeight !== undefined ? Number(targetWeight.toFixed(1)) : undefined,
      createdAt: todayISO(),
    };

    const firstWeight: WeightEntry = {
      id: `weight-${Date.now()}`,
      date: todayISO(),
      weightKg: Number(startWeight.toFixed(1)),
      memo: '시작',
    };

    await Promise.all([persistProfile(nextProfile), persistWeights([firstWeight])]);
    setWeightInput(String(firstWeight.weightKg));
  };

  const saveProfile = async () => {
    if (!profile) {
      await saveInitialProfile();
      return;
    }

    const height = parseDecimal(heightInput);
    const startWeight = parseDecimal(startWeightInput);
    const targetWeight = optionalDecimal(targetWeightInput);

    if (!height || height < 80 || height > 240 || !startWeight || startWeight < 20 || startWeight > 300) {
      Alert.alert('프로필 확인', '키와 시작 몸무게를 다시 확인해 주세요.');
      return;
    }

    if (
      targetWeightInput.trim() &&
      (targetWeight === undefined || targetWeight < 20 || targetWeight > 300)
    ) {
      Alert.alert('목표 몸무게 확인', '목표 몸무게를 kg 단위로 다시 입력해 주세요.');
      return;
    }

    await persistProfile({
      ...profile,
      heightCm: Number(height.toFixed(1)),
      startWeightKg: Number(startWeight.toFixed(1)),
      targetWeightKg: targetWeight !== undefined ? Number(targetWeight.toFixed(1)) : undefined,
    });
    Alert.alert('저장 완료', '프로필을 업데이트했어요.');
  };

  const saveWeight = async () => {
    const weight = parseDecimal(weightInput);

    if (!isValidDate(weightDate)) {
      Alert.alert('날짜 확인', '날짜는 2026-07-07 형식으로 입력해 주세요.');
      return;
    }

    if (!weight || weight < 20 || weight > 300) {
      Alert.alert('몸무게 확인', '몸무게를 kg 단위로 다시 입력해 주세요.');
      return;
    }

    const existing = weights.find((entry) => entry.date === weightDate);
    const nextEntry: WeightEntry = {
      id: existing?.id ?? `weight-${Date.now()}`,
      date: weightDate,
      weightKg: Number(weight.toFixed(1)),
      memo: weightMemo.trim() || undefined,
    };
    const nextWeights = existing
      ? weights.map((entry) => (entry.id === existing.id ? nextEntry : entry))
      : [...weights, nextEntry];

    await persistWeights(nextWeights);
    setWeightInput('');
    setWeightMemo('');
  };

  const deleteWeight = (id: string) => {
    Alert.alert('기록 삭제', '이 체중 기록을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => persistWeights(weights.filter((entry) => entry.id !== id)),
      },
    ]);
  };

  const saveInbody = async () => {
    if (!isValidDate(inbodyDate)) {
      Alert.alert('날짜 확인', '날짜는 2026-07-07 형식으로 입력해 주세요.');
      return;
    }

    const parsed = {
      weightKg: optionalDecimal(inbodyWeight),
      skeletalMuscleKg: optionalDecimal(skeletalMuscle),
      bodyFatPercent: optionalDecimal(bodyFatPercent),
      bodyFatMassKg: optionalDecimal(bodyFatMass),
      visceralFatLevel: optionalDecimal(visceralFat),
    };

    if (Object.values(parsed).every((value) => value === undefined) && !inbodyMemo.trim()) {
      Alert.alert('인바디 확인', '저장할 값을 하나 이상 입력해 주세요.');
      return;
    }

    const existing = inbodyEntries.find((entry) => entry.date === inbodyDate);
    const nextEntry: InbodyEntry = {
      id: existing?.id ?? `inbody-${Date.now()}`,
      date: inbodyDate,
      ...parsed,
      memo: inbodyMemo.trim() || undefined,
    };
    const nextEntries = existing
      ? inbodyEntries.map((entry) => (entry.id === existing.id ? nextEntry : entry))
      : [...inbodyEntries, nextEntry];

    await persistInbody(nextEntries);
    setInbodyWeight('');
    setSkeletalMuscle('');
    setBodyFatPercent('');
    setBodyFatMass('');
    setVisceralFat('');
    setInbodyMemo('');
  };

  const deleteInbody = (id: string) => {
    Alert.alert('기록 삭제', '이 인바디 기록을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => persistInbody(inbodyEntries.filter((entry) => entry.id !== id)),
      },
    ]);
  };

  if (!isReady) {
    return (
      <SafeAreaView style={[styles.loadingScreen, styles.androidSafeArea]}>
        <ActivityIndicator color={colors.blue} size="large" />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={[styles.screen, styles.androidSafeArea]}>
        <ExpoStatusBar style="dark" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.onboardingContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ref={onboardingScrollRef}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.appBadge}>
              <Scale color={colors.blue} size={26} strokeWidth={2.5} />
            </View>
            <Text style={styles.heroTitle}>몸무게 기록</Text>
            <Text style={styles.heroSubcopy}>심플하게 적고, 추세만 봅니다.</Text>

            <View style={styles.panel}>
              <Field
                autoFocus
                keyboardType="decimal-pad"
                label="키(cm)"
                onChangeText={setHeightInput}
                onSubmitEditing={() => focusNext(onboardingStartWeightRef)}
                placeholder="175"
                ref={onboardingHeightRef}
                scrollViewRef={onboardingScrollRef}
                value={heightInput}
              />
              <Field
                keyboardType="decimal-pad"
                label="시작 몸무게(kg)"
                onChangeText={setStartWeightInput}
                onSubmitEditing={() => focusNext(onboardingTargetWeightRef)}
                placeholder="82.4"
                ref={onboardingStartWeightRef}
                scrollViewRef={onboardingScrollRef}
                value={startWeightInput}
              />
              <Field
                keyboardType="decimal-pad"
                label="목표 몸무게(선택)"
                onChangeText={setTargetWeightInput}
                onSubmitEditing={saveInitialProfile}
                placeholder="75"
                ref={onboardingTargetWeightRef}
                returnKeyType="done"
                scrollViewRef={onboardingScrollRef}
                value={targetWeightInput}
              />
              <AppButton icon={Check} label="시작하기" onPress={saveInitialProfile} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, styles.androidSafeArea]}>
      <ExpoStatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>{todayISO()}</Text>
            <Text style={styles.title}>몸무게 기록</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>
              {latestWeight ? formatKg(latestWeight.weightKg) : formatKg(profile.startWeightKg)}
            </Text>
          </View>
        </View>

        <View style={styles.tabs}>
          <TabButton icon={Scale} isActive={tab === 'weight'} label="체중" onPress={() => setTab('weight')} />
          <TabButton
            icon={Activity}
            isActive={tab === 'inbody'}
            label="인바디"
            onPress={() => setTab('inbody')}
          />
          <TabButton
            icon={UserRound}
            isActive={tab === 'profile'}
            label="프로필"
            onPress={() => setTab('profile')}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ref={mainScrollRef}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'weight' && (
            <>
              <View style={styles.statsGrid}>
                <StatCard label="현재" value={latestWeight ? formatKg(latestWeight.weightKg) : '-'} />
                <StatCard
                  label="7일 변화"
                  tone="green"
                  value={sevenDayChange !== undefined ? signedKg(sevenDayChange) : '-'}
                />
                <StatCard label="BMI" tone="amber" value={bmi ? bmi.toFixed(1) : '-'} />
              </View>

              {progress !== undefined && (
                <View style={styles.goalPanel}>
                  <View style={styles.goalTextRow}>
                    <Text style={styles.sectionTitle}>목표</Text>
                    <Text style={styles.goalValue}>{goalStatusText ?? '-'}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                </View>
              )}

              <View style={styles.panel}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <LineChart color={colors.blue} size={20} />
                    <Text style={styles.sectionTitle}>추세</Text>
                  </View>
                  <View style={styles.windowSelector}>
                    {[7, 14, 30].map((days) => (
                      <Pressable
                        accessibilityRole="button"
                        key={days}
                        onPress={() => setWindowDays(days)}
                        style={[styles.windowChip, windowDays === days && styles.windowChipActive]}
                      >
                        <Text style={[styles.windowChipText, windowDays === days && styles.windowChipTextActive]}>
                          {days}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <WeightChart entries={weights} windowDays={windowDays} />
              </View>

              <View style={styles.panel}>
                <View style={styles.sectionTitleRow}>
                  <Plus color={colors.green} size={20} />
                  <Text style={styles.sectionTitle}>체중 입력</Text>
                </View>
                <Field
                  label="날짜"
                  onChangeText={setWeightDate}
                  onSubmitEditing={() => focusNext(weightValueRef)}
                  placeholder="2026-07-07"
                  ref={weightDateRef}
                  scrollViewRef={mainScrollRef}
                  value={weightDate}
                />
                <Field
                  keyboardType="decimal-pad"
                  label="몸무게(kg)"
                  onChangeText={setWeightInput}
                  onSubmitEditing={() => focusNext(weightMemoRef)}
                  placeholder="80.2"
                  ref={weightValueRef}
                  scrollViewRef={mainScrollRef}
                  value={weightInput}
                />
                <Field
                  label="메모(선택)"
                  multiline
                  onChangeText={setWeightMemo}
                  onSubmitEditing={saveWeight}
                  placeholder="회식, 야식, 운동 등"
                  ref={weightMemoRef}
                  returnKeyType="done"
                  scrollViewRef={mainScrollRef}
                  value={weightMemo}
                />
                <AppButton icon={Check} label="체중 저장" onPress={saveWeight} />
              </View>

              <View style={styles.panel}>
                <View style={styles.sectionTitleRow}>
                  <ClipboardList color={colors.ink} size={20} />
                  <Text style={styles.sectionTitle}>체중 히스토리</Text>
                </View>
                {sortByDateDesc(weights).map((entry) => (
                  <View key={entry.id} style={styles.historyItem}>
                    <View style={styles.historyMain}>
                      <Text style={styles.historyDate}>{formatDate(entry.date)}</Text>
                      <Text style={styles.historyValue}>{formatKg(entry.weightKg)}</Text>
                      {entry.memo ? <Text style={styles.historyMemo}>{entry.memo}</Text> : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => deleteWeight(entry.id)}
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                    >
                      <Trash2 color={colors.red} size={18} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </>
          )}

          {tab === 'inbody' && (
            <>
              <View style={styles.statsGrid}>
                <StatCard
                  label="최근 체지방률"
                  value={
                    latestInbody?.bodyFatPercent !== undefined
                      ? `${latestInbody.bodyFatPercent.toFixed(1)}%`
                      : '-'
                  }
                />
                <StatCard
                  label="최근 골격근"
                  tone="green"
                  value={
                    latestInbody?.skeletalMuscleKg !== undefined
                      ? formatKg(latestInbody.skeletalMuscleKg)
                      : '-'
                  }
                />
                <StatCard
                  label="인바디 횟수"
                  tone="amber"
                  value={`${inbodyEntries.length}`}
                />
              </View>

              <View style={styles.panel}>
                <View style={styles.sectionTitleRow}>
                  <Plus color={colors.green} size={20} />
                  <Text style={styles.sectionTitle}>인바디 입력</Text>
                </View>
                <Field
                  label="날짜"
                  onChangeText={setInbodyDate}
                  onSubmitEditing={() => focusNext(inbodyWeightRef)}
                  placeholder="2026-07-07"
                  ref={inbodyDateRef}
                  scrollViewRef={mainScrollRef}
                  value={inbodyDate}
                />
                <View style={styles.twoColumns}>
                  <Field
                    keyboardType="decimal-pad"
                    label="체중"
                    onChangeText={setInbodyWeight}
                    onSubmitEditing={() => focusNext(skeletalMuscleRef)}
                    placeholder="80.2"
                    ref={inbodyWeightRef}
                    scrollViewRef={mainScrollRef}
                    value={inbodyWeight}
                  />
                  <Field
                    keyboardType="decimal-pad"
                    label="골격근"
                    onChangeText={setSkeletalMuscle}
                    onSubmitEditing={() => focusNext(bodyFatPercentRef)}
                    placeholder="34.0"
                    ref={skeletalMuscleRef}
                    scrollViewRef={mainScrollRef}
                    value={skeletalMuscle}
                  />
                </View>
                <View style={styles.twoColumns}>
                  <Field
                    keyboardType="decimal-pad"
                    label="체지방률"
                    onChangeText={setBodyFatPercent}
                    onSubmitEditing={() => focusNext(bodyFatMassRef)}
                    placeholder="22.5"
                    ref={bodyFatPercentRef}
                    scrollViewRef={mainScrollRef}
                    value={bodyFatPercent}
                  />
                  <Field
                    keyboardType="decimal-pad"
                    label="체지방량"
                    onChangeText={setBodyFatMass}
                    onSubmitEditing={() => focusNext(visceralFatRef)}
                    placeholder="18.1"
                    ref={bodyFatMassRef}
                    scrollViewRef={mainScrollRef}
                    value={bodyFatMass}
                  />
                </View>
                <Field
                  keyboardType="decimal-pad"
                  label="내장지방 레벨"
                  onChangeText={setVisceralFat}
                  onSubmitEditing={() => focusNext(inbodyMemoRef)}
                  placeholder="8"
                  ref={visceralFatRef}
                  scrollViewRef={mainScrollRef}
                  value={visceralFat}
                />
                <Field
                  label="메모(선택)"
                  multiline
                  onChangeText={setInbodyMemo}
                  onSubmitEditing={saveInbody}
                  placeholder="검사 컨디션 등"
                  ref={inbodyMemoRef}
                  returnKeyType="done"
                  scrollViewRef={mainScrollRef}
                  value={inbodyMemo}
                />
                <AppButton icon={Check} label="인바디 저장" onPress={saveInbody} />
              </View>

              <View style={styles.panel}>
                <View style={styles.sectionTitleRow}>
                  <ClipboardList color={colors.ink} size={20} />
                  <Text style={styles.sectionTitle}>인바디 히스토리</Text>
                </View>
                {inbodyEntries.length === 0 ? (
                  <Text style={styles.emptyText}>기록 없음</Text>
                ) : (
                  sortByDateDesc(inbodyEntries).map((entry) => (
                    <View key={entry.id} style={styles.historyItem}>
                      <View style={styles.historyMain}>
                        <Text style={styles.historyDate}>{formatDate(entry.date)}</Text>
                        <Text style={styles.historyValue}>
                          {[
                            entry.weightKg !== undefined ? `체중 ${formatKg(entry.weightKg)}` : undefined,
                            entry.skeletalMuscleKg !== undefined
                              ? `골격근 ${formatKg(entry.skeletalMuscleKg)}`
                              : undefined,
                            entry.bodyFatPercent !== undefined
                              ? `체지방 ${entry.bodyFatPercent.toFixed(1)}%`
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        {entry.memo ? <Text style={styles.historyMemo}>{entry.memo}</Text> : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => deleteInbody(entry.id)}
                        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      >
                        <Trash2 color={colors.red} size={18} />
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            </>
          )}

          {tab === 'profile' && (
            <View style={styles.panel}>
              <View style={styles.sectionTitleRow}>
                <Target color={colors.blue} size={20} />
                <Text style={styles.sectionTitle}>프로필</Text>
              </View>
              <Field
                keyboardType="decimal-pad"
                label="키(cm)"
                onChangeText={setHeightInput}
                onSubmitEditing={() => focusNext(profileStartWeightRef)}
                placeholder="175"
                ref={profileHeightRef}
                scrollViewRef={mainScrollRef}
                value={heightInput}
              />
              <Field
                keyboardType="decimal-pad"
                label="시작 몸무게(kg)"
                onChangeText={setStartWeightInput}
                onSubmitEditing={() => focusNext(profileTargetWeightRef)}
                placeholder="82.4"
                ref={profileStartWeightRef}
                scrollViewRef={mainScrollRef}
                value={startWeightInput}
              />
              <Field
                keyboardType="decimal-pad"
                label="목표 몸무게(선택)"
                onChangeText={setTargetWeightInput}
                onSubmitEditing={saveProfile}
                placeholder="75"
                ref={profileTargetWeightRef}
                returnKeyType="done"
                scrollViewRef={mainScrollRef}
                value={targetWeightInput}
              />
              <AppButton icon={Check} label="프로필 저장" onPress={saveProfile} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TabButton({
  icon: Icon,
  isActive,
  label,
  onPress,
}: {
  icon: AppIcon;
  isActive: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      onPress={onPress}
      style={({ pressed }) => [styles.tabButton, isActive && styles.tabButtonActive, pressed && styles.pressed]}
    >
      <Icon color={isActive ? colors.blue : colors.muted} size={18} strokeWidth={2.4} />
      <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  appBadge: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.blueSoft,
    borderRadius: 8,
    height: 52,
    justifyContent: 'center',
    marginBottom: 18,
    width: 52,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonDanger: {
    backgroundColor: colors.red,
  },
  buttonPrimary: {
    backgroundColor: colors.blue,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonSecondaryText: {
    color: colors.ink,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '800',
  },
  chartWrap: {
    alignItems: 'center',
    marginTop: 12,
  },
  content: {
    gap: 16,
    padding: 16,
    paddingBottom: KEYBOARD_EXTRA_SPACE,
  },
  emptyChart: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 8,
    height: 180,
    justifyContent: 'center',
    marginTop: 12,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    paddingVertical: 8,
  },
  emptyTitle: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  field: {
    flex: 1,
    gap: 8,
  },
  flex: {
    flex: 1,
  },
  goalPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  goalTextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  goalValue: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '800',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  headerBadge: {
    backgroundColor: colors.greenSoft,
    borderColor: '#BFE9DC',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerBadgeText: {
    color: colors.green,
    fontSize: 15,
    fontWeight: '900',
  },
  heroSubcopy: {
    color: colors.muted,
    fontSize: 15,
    marginBottom: 24,
    textAlign: 'center',
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 8,
    textAlign: 'center',
  },
  historyDate: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  historyItem: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  historyMain: {
    flex: 1,
    gap: 4,
  },
  historyMemo: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  historyValue: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.redSoft,
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 17,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  kicker: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  legendDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  legendDotActual: {
    backgroundColor: colors.ink,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendLine: {
    borderRadius: 2,
    height: 4,
    width: 18,
  },
  legendLineAverage: {
    backgroundColor: colors.blue,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    marginTop: -4,
  },
  legendText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flex: 1,
    justifyContent: 'center',
  },
  memoInput: {
    minHeight: 92,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  onboardingContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 22,
    paddingBottom: KEYBOARD_EXTRA_SPACE,
    paddingTop: 34,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: 18,
  },
  pressed: {
    opacity: 0.72,
  },
  progressFill: {
    backgroundColor: colors.green,
    borderRadius: 999,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: colors.greenSoft,
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  screen: {
    backgroundColor: colors.bg,
    flex: 1,
  },
  androidSafeArea: {
    paddingTop: ANDROID_TOP_INSET,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  statAmber: {
    backgroundColor: colors.amberSoft,
    borderColor: '#F2D28C',
  },
  statCard: {
    backgroundColor: colors.blueSoft,
    borderColor: '#CADBFF',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: 100,
    padding: 12,
  },
  statGreen: {
    backgroundColor: colors.greenSoft,
    borderColor: '#BFE9DC',
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 7,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statValue: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '900',
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
  },
  tabButtonActive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  tabLabelActive: {
    color: colors.blue,
  },
  tabs: {
    backgroundColor: '#E9EDF5',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 2,
    marginHorizontal: 16,
    padding: 4,
  },
  title: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 0,
  },
  twoColumns: {
    flexDirection: 'row',
    gap: 10,
  },
  windowChip: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 40,
  },
  windowChipActive: {
    backgroundColor: colors.blue,
  },
  windowChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '900',
  },
  windowChipTextActive: {
    color: colors.surface,
  },
  windowSelector: {
    backgroundColor: '#EEF1F6',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
  },
});
